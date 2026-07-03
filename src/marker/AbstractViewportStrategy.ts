import { GeoRectBounds } from '../features';
import { HexGeocell } from '../geocell/HexGeocell';
import { AbstractMarkerRenderingStrategy } from './AbstractMarkerRenderingStrategy';
import { MarkerManager } from './MarkerManager';
import { MarkerOverlayRenderer } from './MarkerOverlayRenderer';
import { BitmapIcon } from './MarkerOverlayRenderer';
import { MarkerEntity } from './MarkerEntity';
import { MarkerState } from './MarkerState';

/**
 * Abstract base for marker rendering strategies that use viewport-based optimization.
 * Only markers within the current camera viewport are rendered; out-of-viewport
 * markers are tracked in the manager but not submitted to the renderer.
 * Mirrors `AbstractViewportStrategy` from `AbstractViewportStrategy.kt`.
 */
export abstract class AbstractViewportStrategy<ActualMarker>
    extends AbstractMarkerRenderingStrategy<ActualMarker>
{
    override readonly markerManager: MarkerManager<ActualMarker>;

    constructor({
        geocell,
        minMarkerCount = 0,
    }: {
        geocell: HexGeocell;
        minMarkerCount?: number;
    }) {
        const manager = new MarkerManager<ActualMarker>(geocell, minMarkerCount);
        super(manager);
        this.markerManager = manager;
    }

    override async onAdd({
        data,
        viewport,
        renderer,
    }: {
        data: MarkerState[];
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean> {
        const previousIds = new Set(this.markerManager.allEntities().map(e => e.state.id));

        const toAdd: { state: MarkerState; bitmapIcon: BitmapIcon }[] = [];
        const toUpdate: { current: MarkerEntity<ActualMarker>; prev: MarkerEntity<ActualMarker>; bitmapIcon: BitmapIcon }[] = [];
        const toRemove: MarkerEntity<ActualMarker>[] = [];

        for (const state of data) {
            const inViewport = viewport.contains(state.position);

            if (previousIds.has(state.id)) {
                previousIds.delete(state.id);
                const prev = this.markerManager.getEntity(state.id)!;
                const icon = state.icon?.toBitmapIcon() ?? this.defaultMarkerIcon;
                if (inViewport) {
                    toUpdate.push({ current: { ...prev, state }, prev, bitmapIcon: icon });
                } else {
                    this.markerManager.registerEntity({ ...prev, state });
                }
            } else {
                previousIds.delete(state.id);
                if (inViewport) {
                    toAdd.push({ state, bitmapIcon: state.icon?.toBitmapIcon() ?? this.defaultMarkerIcon });
                } else {
                    const entity: MarkerEntity<ActualMarker> = {
                        marker: null as unknown as ActualMarker,
                        state,
                        visible: true,
                        isRendered: true,
                        fingerPrint: state.fingerPrint(),
                    };
                    this.markerManager.registerEntity(entity);
                }
            }
        }

        for (const id of previousIds) {
            const removed = this.markerManager.removeEntity(id);
            if (removed) toRemove.push(removed);
        }

        if (toRemove.length > 0) renderer.onRemove(toRemove);

        if (toAdd.length > 0) {
            const actual = await renderer.onAdd(toAdd);
            actual.forEach((am, i) => {
                if (am == null) return;
                const entity: MarkerEntity<ActualMarker> = {
                    marker: am,
                    state: toAdd[i].state,
                    visible: true,
                    isRendered: true,
                    fingerPrint: toAdd[i].state.fingerPrint(),
                };
                this.markerManager.registerEntity(entity);
            });
        }

        if (toUpdate.length > 0) {
            const actual = await renderer.onChange(toUpdate);
            actual.forEach((am, i) => {
                if (am == null) return;
                const entity: MarkerEntity<ActualMarker> = {
                    marker: am,
                    state: toUpdate[i].current.state,
                    visible: true,
                    isRendered: true,
                    fingerPrint: toUpdate[i].current.state.fingerPrint(),
                };
                this.markerManager.registerEntity(entity);
            });
        }

        await renderer.onPostProcess();
        return true;
    }

    override async onUpdate({
        state,
        viewport,
        renderer,
    }: {
        state: MarkerState;
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean> {
        const prev = this.markerManager.getEntity(state.id);
        if (!prev) return true;

        const currentFP = state.fingerPrint();
        if (JSON.stringify(currentFP) === JSON.stringify(prev.fingerPrint)) return true;

        const inViewport = viewport.contains(state.position);
        this.markerManager.registerEntity({ ...prev, state, fingerPrint: currentFP });

        if (inViewport) {
            const icon = state.icon?.toBitmapIcon() ?? this.defaultMarkerIcon;
            const actual = await renderer.onChange([{ current: { ...prev, state }, prev, bitmapIcon: icon }]);
            if (actual[0] != null) {
                this.markerManager.registerEntity({
                    marker: actual[0],
                    state,
                    visible: true,
                    isRendered: true,
                    fingerPrint: currentFP,
                });
            }
        }
        return true;
    }

    override clear(): void {
        this.markerManager.clear();
    }
}
