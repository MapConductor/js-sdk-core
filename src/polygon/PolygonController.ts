import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createPolygonEntity, PolygonEntity } from "./PolygonEntity";
import { PolygonManagerInterface } from "./PolygonManager";
import { PolygonAddParams, PolygonChangeParams, PolygonOverlayRenderer } from "./PolygonOverlayRenderer";
import { PolygonEvent, OnPolygonEventHandler, PolygonState } from "./PolygonState";

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
    a: ReturnType<PolygonState["fingerPrint"]>,
    b: ReturnType<PolygonState["fingerPrint"]>,
): boolean {
    return (
        a.id === b.id &&
        a.strokeColor === b.strokeColor &&
        a.strokeWidth === b.strokeWidth &&
        a.fillColor === b.fillColor &&
        a.geodesic === b.geodesic &&
        a.zIndex === b.zIndex &&
        a.points === b.points &&
        a.holes === b.holes &&
        a.extra === b.extra
    );
}

export abstract class PolygonController<ActualPolygon>
    implements OverlayController<PolygonState, PolygonEntity<ActualPolygon>, PolygonEvent>
{
    readonly zIndex: number = 3;
    public readonly polygonManager: PolygonManagerInterface<ActualPolygon>;
    public readonly renderer: PolygonOverlayRenderer<ActualPolygon>;
    public clickListener: OnPolygonEventHandler | null;
    private semaphore = new Mutex();

    constructor({
        polygonManager,
        renderer,
        clickListener = null,
    }: {
        polygonManager: PolygonManagerInterface<ActualPolygon>;
        renderer: PolygonOverlayRenderer<ActualPolygon>;
        clickListener?: OnPolygonEventHandler | null;
    }) {
        this.polygonManager = polygonManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
    }

    dispatchClick(event: PolygonEvent): void {
        event.state.onClick?.(event);
        this.clickListener?.(event);
    }

    async add(data: PolygonState[]): Promise<void> {
        await this.semaphore.withLock(async () => {
            const previous = new Set(this.polygonManager.allEntities().map((e) => e.state.id));
            const added: PolygonAddParams[] = [];
            const updated: PolygonChangeParams<ActualPolygon>[] = [];
            const removed: PolygonEntity<ActualPolygon>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.polygonManager.getEntity(state.id)!;
                    updated.push({ current: createPolygonEntity({ polygon: prevEntity.polygon, state }), prev: prevEntity });
                    previous.delete(state.id);
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            for (const remainId of previous) {
                const e = this.polygonManager.removeEntity(remainId);
                if (e) removed.push(e);
            }

            if (removed.length > 0) await this.renderer.onRemove(removed);

            if (added.length > 0) {
                const polygons = await this.renderer.onAdd(added);
                polygons.forEach((polygon, i) => {
                    if (polygon != null) {
                        this.polygonManager.registerEntity(
                            createPolygonEntity({ polygon, state: added[i].state }),
                        );
                    }
                });
            }

            if (updated.length > 0) {
                const polygons = await this.renderer.onChange(updated);
                polygons.forEach((polygon, i) => {
                    if (polygon != null) {
                        this.polygonManager.registerEntity(
                            createPolygonEntity({ polygon, state: updated[i].current.state }),
                        );
                    }
                });
            }

            await this.renderer.onPostProcess();
        });
    }

    async update(state: PolygonState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.polygonManager.getEntity(state.id);
            if (!prevEntity) return;

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintsEqual(currentFinger, prevFinger)) return;

            const params: PolygonChangeParams<ActualPolygon> = {
                current: createPolygonEntity({ polygon: prevEntity.polygon, state }),
                prev: prevEntity,
            };
            const polygons = await this.renderer.onChange([params]);
            if (polygons[0] != null) {
                this.polygonManager.registerEntity(
                    createPolygonEntity({ polygon: polygons[0], state }),
                );
            }
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            await this.renderer.onRemove(this.polygonManager.allEntities());
            this.polygonManager.clear();
        });
    }

    find(position: GeoPoint): PolygonEntity<ActualPolygon> | null {
        return this.polygonManager.find(position);
    }

    async onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void> {}

    destroy(): void {}
}
