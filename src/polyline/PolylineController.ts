import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createPolylineEntity, PolylineEntity } from "./PolylineEntity";
import { PolylineHitResult, PolylineManagerInterface } from "./PolylineManager";
import { PolylineAddParams, PolylineChangeParams, PolylineOverlayRenderer } from "./PolylineOverlayRenderer";
import { OnPolylineEventHandler, PolylineEvent, PolylineState } from "./PolylineState";

class Mutex {
    private locked = false;
    private queue: Array<() => void> = [];
    async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try { return await fn(); } finally { this.release(); }
    }
    private acquire(): Promise<void> {
        if (!this.locked) { this.locked = true; return Promise.resolve(); }
        return new Promise((r) => this.queue.push(r));
    }
    private release(): void {
        const next = this.queue.shift();
        if (next) next(); else this.locked = false;
    }
}

function fingerPrintsEqual(
    a: ReturnType<PolylineState["fingerPrint"]>,
    b: ReturnType<PolylineState["fingerPrint"]>,
): boolean {
    return (
        a.id === b.id &&
        a.strokeColor === b.strokeColor &&
        a.strokeWidth === b.strokeWidth &&
        a.geodesic === b.geodesic &&
        a.zIndex === b.zIndex &&
        a.points === b.points &&
        a.extra === b.extra
    );
}

export abstract class PolylineController<ActualPolyline>
    implements OverlayController<PolylineState, PolylineEntity<ActualPolyline>, PolylineEvent>
{
    readonly zIndex: number = 5;
    public readonly polylineManager: PolylineManagerInterface<ActualPolyline>;
    public readonly renderer: PolylineOverlayRenderer<ActualPolyline>;
    public clickListener: OnPolylineEventHandler | null;
    private semaphore = new Mutex();
    private currentCameraPosition: MapCameraPosition | null = null;

    constructor({
        polylineManager,
        renderer,
        clickListener = null,
    }: {
        polylineManager: PolylineManagerInterface<ActualPolyline>;
        renderer: PolylineOverlayRenderer<ActualPolyline>;
        clickListener?: OnPolylineEventHandler | null;
    }) {
        this.polylineManager = polylineManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
    }

    dispatchClick(event: PolylineEvent): void {
        event.state.onClick?.(event);
        this.clickListener?.(event);
    }

    async add(data: PolylineState[]): Promise<void> {
        await this.semaphore.withLock(async () => {
            const previous = new Set(this.polylineManager.allEntities().map((e) => e.state.id));
            const added: PolylineAddParams[] = [];
            const updated: PolylineChangeParams<ActualPolyline>[] = [];
            const removed: PolylineEntity<ActualPolyline>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.polylineManager.getEntity(state.id)!;
                    updated.push({
                        current: createPolylineEntity({ polyline: prevEntity.polyline, state }),
                        prev: prevEntity,
                    });
                    previous.delete(state.id);
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            for (const remainId of previous) {
                const e = this.polylineManager.removeEntity(remainId);
                if (e) removed.push(e);
            }

            if (removed.length > 0) await this.renderer.onRemove(removed);

            if (added.length > 0) {
                const polylines = await this.renderer.onAdd(added);
                polylines.forEach((polyline, i) => {
                    if (polyline != null) {
                        this.polylineManager.registerEntity(
                            createPolylineEntity({ polyline, state: added[i].state }),
                        );
                    }
                });
            }

            if (updated.length > 0) {
                const polylines = await this.renderer.onChange(updated);
                polylines.forEach((polyline, i) => {
                    if (polyline != null) {
                        this.polylineManager.registerEntity(
                            createPolylineEntity({ polyline, state: updated[i].current.state }),
                        );
                    }
                });
            }

            await this.renderer.onPostProcess();
        });
    }

    async update(state: PolylineState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.polylineManager.getEntity(state.id);
            if (!prevEntity) return;

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintsEqual(currentFinger, prevFinger)) return;

            const params: PolylineChangeParams<ActualPolyline> = {
                current: createPolylineEntity({ polyline: prevEntity.polyline, state }),
                prev: prevEntity,
            };
            const polylines = await this.renderer.onChange([params]);
            if (polylines[0] != null) {
                this.polylineManager.registerEntity(
                    createPolylineEntity({ polyline: polylines[0], state }),
                );
            }
            await this.renderer.onPostProcess();
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            await this.renderer.onRemove(this.polylineManager.allEntities());
            await this.renderer.onPostProcess();
            this.polylineManager.clear();
        });
    }

    find(position: GeoPoint): PolylineEntity<ActualPolyline> | null {
        return this.polylineManager.find(position, this.currentCameraPosition)?.entity ?? null;
    }

    findWithClosestPoint(position: GeoPoint): PolylineHitResult<ActualPolyline> | null {
        return this.polylineManager.find(position, this.currentCameraPosition);
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        this.currentCameraPosition = mapCameraPosition;
    }

    destroy(): void {}
}
