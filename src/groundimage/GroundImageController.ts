import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createGroundImageEntity, GroundImageEntity } from "./GroundImageEntity";
import { GroundImageManagerInterface } from "./GroundImageManager";
import { GroundImageAddParams, GroundImageChangeParams, GroundImageOverlayRenderer } from "./GroundImageOverlayRenderer";
import { GroundImageEvent, OnGroundImageEventHandler, GroundImageState } from "./GroundImageState";

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
    a: ReturnType<GroundImageState["fingerPrint"]>,
    b: ReturnType<GroundImageState["fingerPrint"]>,
): boolean {
    return (
        a.id === b.id &&
        a.bounds === b.bounds &&
        a.imageUrl === b.imageUrl &&
        a.opacity === b.opacity &&
        a.tileSize === b.tileSize &&
        a.extra === b.extra
    );
}

export abstract class GroundImageController<ActualGroundImage>
    implements OverlayController<GroundImageState, GroundImageEntity<ActualGroundImage>, GroundImageEvent>
{
    readonly zIndex: number = 2;
    public readonly groundImageManager: GroundImageManagerInterface<ActualGroundImage>;
    public readonly renderer: GroundImageOverlayRenderer<ActualGroundImage>;
    public clickListener: OnGroundImageEventHandler | null;
    private semaphore = new Mutex();

    constructor({
        groundImageManager,
        renderer,
        clickListener = null,
    }: {
        groundImageManager: GroundImageManagerInterface<ActualGroundImage>;
        renderer: GroundImageOverlayRenderer<ActualGroundImage>;
        clickListener?: OnGroundImageEventHandler | null;
    }) {
        this.groundImageManager = groundImageManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
    }

    dispatchClick(event: GroundImageEvent): void {
        event.state.onClick?.(event);
        this.clickListener?.(event);
    }

    async add(data: GroundImageState[]): Promise<void> {
        await this.semaphore.withLock(async () => {
            const previous = new Set(this.groundImageManager.allEntities().map((e) => e.state.id));
            const added: GroundImageAddParams[] = [];
            const updated: GroundImageChangeParams<ActualGroundImage>[] = [];
            const removed: GroundImageEntity<ActualGroundImage>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.groundImageManager.getEntity(state.id)!;
                    updated.push({
                        current: createGroundImageEntity({ groundImage: prevEntity.groundImage, state }),
                        prev: prevEntity,
                    });
                    previous.delete(state.id);
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            for (const remainId of previous) {
                const e = this.groundImageManager.removeEntity(remainId);
                if (e) removed.push(e);
            }

            if (removed.length > 0) await this.renderer.onRemove(removed);

            if (added.length > 0) {
                const images = await this.renderer.onAdd(added);
                images.forEach((img, i) => {
                    if (img != null) {
                        this.groundImageManager.registerEntity(
                            createGroundImageEntity({ groundImage: img, state: added[i].state }),
                        );
                    }
                });
            }

            if (updated.length > 0) {
                const images = await this.renderer.onChange(updated);
                images.forEach((img, i) => {
                    if (img != null) {
                        this.groundImageManager.registerEntity(
                            createGroundImageEntity({ groundImage: img, state: updated[i].current.state }),
                        );
                    }
                });
            }

            await this.renderer.onPostProcess();
        });
    }

    async update(state: GroundImageState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.groundImageManager.getEntity(state.id);
            if (!prevEntity) return;

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintsEqual(currentFinger, prevFinger)) return;

            const params: GroundImageChangeParams<ActualGroundImage> = {
                current: createGroundImageEntity({ groundImage: prevEntity.groundImage, state }),
                prev: prevEntity,
            };
            const images = await this.renderer.onChange([params]);
            if (images[0] != null) {
                this.groundImageManager.registerEntity(
                    createGroundImageEntity({ groundImage: images[0], state }),
                );
            }
            await this.renderer.onPostProcess();
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            await this.renderer.onRemove(this.groundImageManager.allEntities());
            await this.renderer.onPostProcess();
            this.groundImageManager.clear();
        });
    }

    find(position: GeoPoint): GroundImageEntity<ActualGroundImage> | null {
        return this.groundImageManager.find(position);
    }

    async onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void> {}

    destroy(): void {}
}
