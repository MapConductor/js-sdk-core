import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createRasterLayerEntity, RasterLayerEntity } from "./RasterLayerEntity";
import { RasterLayerManagerInterface } from "./RasterLayerManager";
import { RasterLayerAddParams, RasterLayerChangeParams, RasterLayerOverlayRenderer } from "./RasterLayerOverlayRenderer";
import { OnRasterLayerEventHandler, RasterLayerEvent, RasterLayerState } from "./RasterLayerState";
import { Mutex } from "../base/Mutex";

function fingerPrintsEqual(
    a: ReturnType<RasterLayerState["fingerPrint"]>,
    b: ReturnType<RasterLayerState["fingerPrint"]>,
): boolean {
    return (
        a.id === b.id &&
        a.source === b.source &&
        a.opacity === b.opacity &&
        a.visible === b.visible &&
        a.zIndex === b.zIndex &&
        a.userAgent === b.userAgent &&
        a.debug === b.debug &&
        a.extra === b.extra
    );
}

export abstract class RasterLayerController<ActualLayer extends object>
    implements OverlayController<RasterLayerState, RasterLayerEntity<ActualLayer>, RasterLayerEvent>
{
    readonly zIndex: number = 0;
    public readonly rasterLayerManager: RasterLayerManagerInterface<ActualLayer>;
    public readonly renderer: RasterLayerOverlayRenderer<ActualLayer>;
    public clickListener: OnRasterLayerEventHandler | null;
    private semaphore = new Mutex();
    private upsertedIds = new Set<string>();

    constructor({
        rasterLayerManager,
        renderer,
        clickListener = null,
    }: {
        rasterLayerManager: RasterLayerManagerInterface<ActualLayer>;
        renderer: RasterLayerOverlayRenderer<ActualLayer>;
        clickListener?: OnRasterLayerEventHandler | null;
    }) {
        this.rasterLayerManager = rasterLayerManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
    }

    async composition(data: RasterLayerState[]): Promise<void> {
        await this.add(data);
    }

    has(state: RasterLayerState): boolean {
        return this.rasterLayerManager.hasEntity(state.id);
    }

    setOnClickListener(listener: OnRasterLayerEventHandler | null): void {
        this.clickListener = listener;
    }

    async add(data: RasterLayerState[]): Promise<void> {
        await this.semaphore.withLock(async () => {
            const previous = new Set(
                this.rasterLayerManager.allEntities()
                    .map((e) => e.state.id)
                    .filter((id) => !this.upsertedIds.has(id)),
            );
            const added: RasterLayerAddParams[] = [];
            const updated: RasterLayerChangeParams<ActualLayer>[] = [];
            const removed: RasterLayerEntity<ActualLayer>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.rasterLayerManager.getEntity(state.id);
                    if (!prevEntity) continue;
                    previous.delete(state.id);
                    if (fingerPrintsEqual(state.fingerPrint(), prevEntity.fingerPrint)) {
                        // Rendered output is unchanged; adopt the latest state
                        // object (it may carry newer event handlers) without a
                        // renderer round-trip. Recreating the actual overlay on
                        // every composition makes async renderers flicker.
                        this.rasterLayerManager.registerEntity(
                            createRasterLayerEntity({ layer: prevEntity.layer, state }),
                        );
                        continue;
                    }
                    updated.push({
                        current: createRasterLayerEntity({ layer: prevEntity.layer, state }),
                        prev: prevEntity,
                    });
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            for (const remainId of previous) {
                const e = this.rasterLayerManager.removeEntity(remainId);
                if (e) removed.push(e);
            }

            if (removed.length > 0) await this.renderer.onRemove(removed);

            if (added.length > 0) {
                const layers = await this.renderer.onAdd(added);
                layers.forEach((layer, i) => {
                    if (layer != null) {
                        this.rasterLayerManager.registerEntity(
                            createRasterLayerEntity({ layer, state: added[i].state }),
                        );
                    }
                });
            }

            if (updated.length > 0) {
                const layers = await this.renderer.onChange(updated);
                layers.forEach((layer, i) => {
                    if (layer != null) {
                        this.rasterLayerManager.registerEntity(
                            createRasterLayerEntity({ layer, state: updated[i].current.state }),
                        );
                    }
                });
            }

            await this.renderer.onPostProcess();
        });
    }

    async update(state: RasterLayerState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.rasterLayerManager.getEntity(state.id);
            if (!prevEntity) return;

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintsEqual(currentFinger, prevFinger)) return;

            const params: RasterLayerChangeParams<ActualLayer> = {
                current: createRasterLayerEntity({ layer: prevEntity.layer, state }),
                prev: prevEntity,
            };
            const layers = await this.renderer.onChange([params]);
            if (layers[0] != null) {
                this.rasterLayerManager.registerEntity(
                    createRasterLayerEntity({ layer: layers[0], state }),
                );
            }
            await this.renderer.onPostProcess();
        });
    }

    async upsert(state: RasterLayerState): Promise<void> {
        await this.semaphore.withLock(async () => {
            this.upsertedIds.add(state.id);
            const prevEntity = this.rasterLayerManager.getEntity(state.id);
            if (prevEntity == null) {
                const layers = await this.renderer.onAdd([{ state }]);
                if (layers[0] != null) {
                    this.rasterLayerManager.registerEntity(
                        createRasterLayerEntity({ layer: layers[0], state }),
                    );
                }
                await this.renderer.onPostProcess();
                return;
            }

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintsEqual(currentFinger, prevFinger)) return;

            const params: RasterLayerChangeParams<ActualLayer> = {
                current: createRasterLayerEntity({ layer: prevEntity.layer, state }),
                prev: prevEntity,
            };
            const layers = await this.renderer.onChange([params]);
            if (layers[0] != null) {
                this.rasterLayerManager.registerEntity(
                    createRasterLayerEntity({ layer: layers[0], state }),
                );
            }
            await this.renderer.onPostProcess();
        });
    }

    async removeById(id: string): Promise<void> {
        await this.semaphore.withLock(async () => {
            this.upsertedIds.delete(id);
            const entity = this.rasterLayerManager.removeEntity(id);
            if (!entity) return;
            await this.renderer.onRemove([entity]);
            await this.renderer.onPostProcess();
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            this.upsertedIds.clear();
            await this.renderer.onRemove(this.rasterLayerManager.allEntities());
            await this.renderer.onPostProcess();
            this.rasterLayerManager.clear();
        });
    }

    find(_position: GeoPoint): RasterLayerEntity<ActualLayer> | null {
        return null;
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        await this.renderer.onCameraChanged(mapCameraPosition);
    }

    destroy(): void {}
}
