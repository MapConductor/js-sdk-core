import { GeoPoint } from "../features";
import { ColorDefaultIcon, MarkerFingerPrint, MarkerManager, MarkerRenderingStrategy, MarkerState } from "../marker";
import { createMarkerEntity, MarkerEntity } from "../marker";
import { AddParams, BitmapIcon, ChangeParams, MarkerOverlayRenderer } from "../marker";
import { MarkerAnimationOverlayHost } from "../marker";
import { OnMarkerEventHandler } from "../marker";
import { MapCameraPosition } from "../types";
import { OverlayController } from "./OverlayController";
import { Mutex } from "../base/Mutex";

const MARKER_RENDER_BATCH_SIZE = 500;

function fingerprintsEqual(a: MarkerFingerPrint, b: MarkerFingerPrint): boolean {
    return (
        a.id === b.id &&
        a.icon === b.icon &&
        a.clickable === b.clickable &&
        a.draggable === b.draggable &&
        a.latitude === b.latitude &&
        a.longitude === b.longitude &&
        a.animation === b.animation &&
        a.zIndex === b.zIndex
    );
}

export abstract class AbstractMarkerController<ActualMarker>
    implements OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState>
{
    readonly zIndex: number = 10;
    private defaultIcon: BitmapIcon = new ColorDefaultIcon("#FF0000").toBitmapIcon();
    private readonly draggingStates = new WeakMap<MarkerState, boolean>();

    dragStartListener: OnMarkerEventHandler | null = null;
    dragListener: OnMarkerEventHandler | null = null;
    dragEndListener: OnMarkerEventHandler | null = null;
    animateStartListener: OnMarkerEventHandler | null = null;
    animateEndListener: OnMarkerEventHandler | null = null;

    private mapCameraPosition: MapCameraPosition | null = null;
    private pendingCameraPosition: MapCameraPosition | null = null;
    private debounceJob: ReturnType<typeof setTimeout> | null = null;
    private debounceMutex = new Mutex();
    private semaphore = new Mutex();

    public markerManager: MarkerManager<ActualMarker>;
    public renderer: MarkerOverlayRenderer<ActualMarker>;
    public clickListener: OnMarkerEventHandler | null;
    public renderingStrategy: MarkerRenderingStrategy<ActualMarker> | null;

    constructor({
        markerManager,
        renderer,
        clickListener = null,
        renderingStrategy = null,
    }: {
        markerManager: MarkerManager<ActualMarker>;
        renderer: MarkerOverlayRenderer<ActualMarker>;
        clickListener?: OnMarkerEventHandler | null;
        renderingStrategy?: MarkerRenderingStrategy<ActualMarker> | null;
    }) {
        this.markerManager = markerManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
        this.renderingStrategy = renderingStrategy;
        this.renderer.animateStartListener = (state) => this.dispatchAnimateStart(state);
        this.renderer.animateEndListener = (state) => this.dispatchAnimateEnd(state);
    }

    abstract find(position: GeoPoint): MarkerEntity<ActualMarker> | null;

    /**
     * Return true if this marker should be rendered as a tile rather than an individual overlay.
     * `totalCount` is the total number of markers in the current composition call.
     */
    protected shouldTile(_state: MarkerState, _totalCount: number): boolean {
        return false;
    }

    dispatchClick(state: MarkerState): void {
        state.onClick?.(state);
        this.clickListener?.(state);
    }

    dispatchDragStart(state: MarkerState): void {
        state.onDragStart?.(state);
        this.dragStartListener?.(state);
    }

    dispatchDrag(state: MarkerState): void {
        state.onDrag?.(state);
        this.dragListener?.(state);
    }

    dispatchDragEnd(state: MarkerState): void {
        state.onDragEnd?.(state);
        this.dragEndListener?.(state);
    }

    dispatchAnimateStart(state: MarkerState): void {
        state.onAnimateStart?.(state);
        this.animateStartListener?.(state);
    }

    dispatchAnimateEnd(state: MarkerState): void {
        state.onAnimateEnd?.(state);
        this.animateEndListener?.(state);
    }

    protected setDraggingState(markerState: MarkerState, dragging: boolean): void {
        this.draggingStates.set(markerState, dragging);
    }

    protected isDragging(markerState: MarkerState): boolean {
        return this.draggingStates.get(markerState) ?? false;
    }

    async add(data: MarkerState[]): Promise<void> {
        await this.semaphore.withLock(async () => {
            const modifiedEntities: MarkerEntity<ActualMarker>[] = [];
            const previous = new Set(this.markerManager.allEntities().map((it) => it.state.id));
            const added: AddParams[] = [];
            const updated: ChangeParams<ActualMarker>[] = [];
            const removed: MarkerEntity<ActualMarker>[] = [];
            // Markers rendered as tiles: registered in markerManager (marker=null) but not in renderer
            const tiledAdded: MarkerState[] = [];
            const tiledUpdated: MarkerState[] = [];

            const totalCount = data.length;
            for (const state of data) {
                const wantsTile = this.shouldTile(state, totalCount);
                if (previous.has(state.id)) {
                    const prevEntity = this.markerManager.getEntity(state.id)!;
                    const wasTiled = prevEntity.marker === null;
                    previous.delete(state.id);

                    if (wantsTile) {
                        if (!wasTiled) {
                            // Transition: regular → tiled. Keep the entity in the manager,
                            // but remove its provider marker before replacing it with marker=null.
                            removed.push(prevEntity);
                        }
                        // Always re-register tiled markers to keep markerManager current
                        tiledUpdated.push(state);
                    } else if (wasTiled) {
                        // Transition: tiled → regular
                        this.markerManager.removeEntity(state.id);
                        removed.push(prevEntity);
                        added.push({ state, bitmapIcon: state.icon?.toBitmapIcon() ?? this.defaultIcon });
                    } else {
                        const currentFinger = state.fingerPrint();
                        if (!fingerprintsEqual(currentFinger, prevEntity.fingerPrint)) {
                            const markerIcon = state.icon?.toBitmapIcon() ?? this.defaultIcon;
                            updated.push({
                                current: createMarkerEntity<ActualMarker>({
                                    marker: prevEntity.marker,
                                    state,
                                    isRendered: true,
                                    visible: true,
                                }),
                                bitmapIcon: markerIcon,
                                prev: prevEntity,
                            });
                        }
                    }
                } else {
                    if (wantsTile) {
                        tiledAdded.push(state);
                    } else {
                        added.push({
                            state,
                            bitmapIcon: state.icon?.toBitmapIcon() ?? this.defaultIcon,
                        });
                    }
                }
            }

            for (const remainId of previous) {
                const removedEntity = this.markerManager.removeEntity(remainId);
                if (removedEntity != null) {
                    removed.push(removedEntity);
                }
            }

            // Register tiled markers in markerManager only (no renderer call)
            for (const state of [...tiledAdded, ...tiledUpdated]) {
                this.markerManager.registerEntity(
                    createMarkerEntity<ActualMarker>({ marker: null, state, isRendered: true, visible: true }),
                );
            }

            // Remove renderer-rendered entities that were removed or transitioned to tiled
            const removedFromRenderer = removed.filter((e) => e.marker !== null);
            if (removedFromRenderer.length > 0) {
                await this.renderer.onRemove(removedFromRenderer);
                if (removedFromRenderer.length >= MARKER_RENDER_BATCH_SIZE) {
                    await new Promise<void>((r) => setTimeout(r, 0));
                }
            }

            if (added.length > 0) {
                for (let i = 0; i < added.length; i += MARKER_RENDER_BATCH_SIZE) {
                    const batch = added.slice(i, i + MARKER_RENDER_BATCH_SIZE);
                    const actualMarkers = await this.renderer.onAdd(batch);
                    actualMarkers.forEach((actualMarker, index) => {
                        if (actualMarker != null) {
                            const entity = createMarkerEntity<ActualMarker>({
                                marker: actualMarker,
                                state: batch[index].state,
                                isRendered: true,
                                visible: true,
                            });
                            this.markerManager.registerEntity(entity);
                            this.onMarkerAdded(entity);
                            modifiedEntities.push(entity);
                        }
                    });
                    await new Promise<void>((r) => setTimeout(r, 0));
                }
            }

            if (updated.length > 0) {
                for (let i = 0; i < updated.length; i += MARKER_RENDER_BATCH_SIZE) {
                    const batch = updated.slice(i, i + MARKER_RENDER_BATCH_SIZE);
                    const actualMarkers = await this.renderer.onChange(batch);
                    actualMarkers.forEach((actualMarker, index) => {
                        if (actualMarker != null) {
                            const entity = createMarkerEntity<ActualMarker>({
                                marker: actualMarker,
                                state: batch[index].current.state,
                                isRendered: true,
                                visible: true,
                            });
                            this.markerManager.registerEntity(entity);
                        }
                    });
                    await new Promise<void>((r) => setTimeout(r, 0));
                }
            }

            for (const entity of modifiedEntities) {
                if (entity.state.getAnimation() != null) {
                    await this.renderer.onAnimate(entity);
                }
            }

            const rendererChanged =
                removedFromRenderer.length > 0 || added.length > 0 || updated.length > 0;
            if (rendererChanged) {
                await this.renderer.onPostProcess();
            }

            const tiledChanged =
                tiledAdded.length > 0 ||
                tiledUpdated.length > 0 ||
                removed.some((entity) => entity.marker === null);
            if (tiledChanged) {
                await this.onTiledMarkersChanged();
            }
        });
    }

    /** Called when tiled markers are added or updated. Override in subclasses to manage tile overlay. */
    protected async onTiledMarkersChanged(): Promise<void> {
        // no-op by default
    }

    /** Called after a provider marker is created and registered. */
    protected onMarkerAdded(_entity: MarkerEntity<ActualMarker>): void {
        // no-op by default
    }

    async update(state: MarkerState): Promise<void> {
        if (!this.markerManager.hasEntity(state.id)) return;

        const prevEntity = this.markerManager.getEntity(state.id);
        if (!prevEntity) return;

        const currentFinger = state.fingerPrint();
        const prevFinger = prevEntity.fingerPrint;
        if (fingerprintsEqual(currentFinger, prevFinger)) return;

        await this.semaphore.withLock(async () => {
            const wantsTile = this.shouldTile(state, this.markerManager.allEntities().length);
            const wasTiled = prevEntity.marker === null;

            if (wantsTile) {
                if (!wasTiled) {
                    await this.renderer.onRemove([prevEntity]);
                }
                this.markerManager.updateEntity(createMarkerEntity<ActualMarker>({
                    state,
                    marker: null,
                    isRendered: true,
                    visible: prevEntity.visible,
                }));
                if (!wasTiled) {
                    await this.renderer.onPostProcess();
                }
                await this.onTiledMarkersChanged();
                return;
            }

            const markerIcon = state.icon?.toBitmapIcon() ?? this.defaultIcon;
            const renderEntity = createMarkerEntity<ActualMarker>({
                state,
                marker: prevEntity.marker,
                isRendered: true,
                visible: prevEntity.visible,
            });
            const markers = wasTiled
                ? await this.renderer.onAdd([{ state, bitmapIcon: markerIcon }])
                : await this.renderer.onChange([{
                    current: renderEntity,
                    bitmapIcon: markerIcon,
                    prev: prevEntity,
                }]);

            if (markers.length === 1 && markers[0] != null) {
                const finalEntity = createMarkerEntity<ActualMarker>({
                    state,
                    marker: markers[0],
                    isRendered: true,
                    visible: prevEntity.visible,
                });
                this.markerManager.updateEntity(finalEntity);
                if (wasTiled) {
                    this.onMarkerAdded(finalEntity);
                }

                if (prevFinger.animation !== currentFinger.animation && state.getAnimation() != null) {
                    await this.renderer.onAnimate(finalEntity);
                }
            }

            await this.renderer.onPostProcess();
            if (wasTiled) {
                await this.onTiledMarkersChanged();
            }
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            const entities = this.markerManager.allEntities();
            const rendered = entities.filter((entity) => entity.marker !== null);
            if (rendered.length > 0) {
                await this.renderer.onRemove(rendered);
            }
            this.markerManager.clear();
        });
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        if (this.mapCameraPosition == null) {
            this.mapCameraPosition = mapCameraPosition;
            await this.renderingStrategy?.onCameraChanged?.(mapCameraPosition, this.renderer);
        } else {
            await this.debounceMutex.withLock(async () => {
                this.pendingCameraPosition = mapCameraPosition;
                if (this.debounceJob != null) {
                    clearTimeout(this.debounceJob);
                }
                this.debounceJob = setTimeout(async () => {
                    const latest = await this.debounceMutex.withLock(
                        async () => this.pendingCameraPosition,
                    );
                    if (latest != null) {
                        this.mapCameraPosition = latest;
                        await this.renderingStrategy?.onCameraChanged?.(latest, this.renderer);
                    }
                }, 100);
            });
        }
    }

    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void {
        this.renderer.animationOverlayHost = host;
    }

    destroy(): void {
        if (this.debounceJob != null) {
            clearTimeout(this.debounceJob);
            this.debounceJob = null;
        }
        this.markerManager.destroy();
    }
}
