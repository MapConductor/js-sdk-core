import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createCircleEntity, CircleEntity } from "./CircleEntity";
import { CircleManagerInterface } from "./CircleManager";
import { CircleAddParams, CircleChangeParams, CircleOverlayRenderer } from "./CircleOverlayRenderer";
import { CircleEvent, CircleState, OnCircleEventHandler } from "./CircleState";

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

function fingerPrintsEqual(a: ReturnType<CircleState["fingerPrint"]>, b: ReturnType<CircleState["fingerPrint"]>): boolean {
    return (
        a.id === b.id &&
        a.center === b.center &&
        a.radiusMeters === b.radiusMeters &&
        a.clickable === b.clickable &&
        a.geodesic === b.geodesic &&
        a.strokeColor === b.strokeColor &&
        a.strokeWidth === b.strokeWidth &&
        a.fillColor === b.fillColor &&
        a.zIndex === b.zIndex &&
        a.extra === b.extra
    );
}

export abstract class CircleController<ActualCircle>
    implements OverlayController<CircleState, CircleEntity<ActualCircle>, CircleEvent>
{
    readonly zIndex: number = 3;
    public readonly circleManager: CircleManagerInterface<ActualCircle>;
    public readonly renderer: CircleOverlayRenderer<ActualCircle>;
    public clickListener: OnCircleEventHandler | null;
    private semaphore = new Mutex();

    constructor({
        circleManager,
        renderer,
        clickListener = null,
    }: {
        circleManager: CircleManagerInterface<ActualCircle>;
        renderer: CircleOverlayRenderer<ActualCircle>;
        clickListener?: OnCircleEventHandler | null;
    }) {
        this.circleManager = circleManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
    }

    dispatchClick(event: CircleEvent): void {
        event.state.onClick?.(event);
        this.clickListener?.(event);
    }

    async add(data: CircleState[]): Promise<void> {
        await this.semaphore.withLock(async () => {
            const previous = new Set(this.circleManager.allEntities().map((e) => e.state.id));
            const added: CircleAddParams[] = [];
            const updated: CircleChangeParams<ActualCircle>[] = [];
            const removed: CircleEntity<ActualCircle>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.circleManager.getEntity(state.id)!;
                    updated.push({ current: createCircleEntity({ circle: prevEntity.circle, state }), prev: prevEntity });
                    previous.delete(state.id);
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            for (const remainId of previous) {
                const e = this.circleManager.removeEntity(remainId);
                if (e) removed.push(e);
            }

            if (removed.length > 0) await this.renderer.onRemove(removed);

            if (added.length > 0) {
                const circles = await this.renderer.onAdd(added);
                circles.forEach((circle, i) => {
                    if (circle != null) {
                        this.circleManager.registerEntity(
                            createCircleEntity({ circle, state: added[i].state }),
                        );
                    }
                });
            }

            if (updated.length > 0) {
                const circles = await this.renderer.onChange(updated);
                circles.forEach((circle, i) => {
                    if (circle != null) {
                        this.circleManager.registerEntity(
                            createCircleEntity({ circle, state: updated[i].current.state }),
                        );
                    }
                });
            }

            await this.renderer.onPostProcess();
        });
    }

    async update(state: CircleState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.circleManager.getEntity(state.id);
            if (!prevEntity) return;

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintsEqual(currentFinger, prevFinger)) return;

            const params: CircleChangeParams<ActualCircle> = {
                current: createCircleEntity({ circle: prevEntity.circle, state }),
                prev: prevEntity,
            };
            const circles = await this.renderer.onChange([params]);
            if (circles[0] != null) {
                this.circleManager.registerEntity(
                    createCircleEntity({ circle: circles[0], state }),
                );
            }
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            await this.renderer.onRemove(this.circleManager.allEntities());
            this.circleManager.clear();
        });
    }

    find(position: GeoPoint): CircleEntity<ActualCircle> | null {
        return this.circleManager.find(position);
    }

    async onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void> {}

    destroy(): void {
        // No native resources to clean up for circles
    }
}
