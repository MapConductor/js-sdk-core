import type { SlottedOverlayController } from '../controller/OverlayController';
import type { OverlayKind } from '../controller/OverlayKind';
import { GeoPoint, wrapClickedPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createGroundImageEntity, GroundImageEntity } from "./GroundImageEntity";
import { GroundImageManagerInterface } from "./GroundImageManager";
import { GroundImageAddParams, GroundImageChangeParams, GroundImageOverlayRenderer } from "./GroundImageOverlayRenderer";
import { GroundImageEvent, OnGroundImageEventHandler, GroundImageState } from "./GroundImageState";
import { Mutex } from "../base/Mutex";

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
    implements SlottedOverlayController, OverlayController<GroundImageState, GroundImageEntity<ActualGroundImage>, GroundImageEvent>
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
        // 配送時に wrap して正規化する。理由は PolygonController.dispatchClick を参照。
        // clicked は null 許容（android-sdk の GroundImageEvent と同じ）。
        const normalized: GroundImageEvent = { ...event, clicked: wrapClickedPoint(event.clicked) };
        normalized.state.onClick?.(normalized);
        this.clickListener?.(normalized);
    }

    async composition(data: GroundImageState[]): Promise<void> {
        await this.add(data);
    }

    has(state: GroundImageState): boolean {
        return this.groundImageManager.hasEntity(state.id);
    }

    setOnClickListener(listener: OnGroundImageEventHandler | null): void {
        this.clickListener = listener;
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
                    previous.delete(state.id);
                    if (fingerPrintsEqual(state.fingerPrint(), prevEntity.fingerPrint)) {
                        // Rendered output is unchanged; adopt the latest state
                        // object (it may carry newer event handlers) without a
                        // renderer round-trip. Recreating the actual overlay on
                        // every composition makes async renderers flicker.
                        this.groundImageManager.registerEntity(
                            createGroundImageEntity({ groundImage: prevEntity.groundImage, state }),
                        );
                        continue;
                    }
                    updated.push({
                        current: createGroundImageEntity({ groundImage: prevEntity.groundImage, state }),
                        prev: prevEntity,
                    });
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
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'groundImage';

    hasId(id: string): boolean {
        return this.has({ id } as GroundImageState);
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.composition(data as GroundImageState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as GroundImageState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnGroundImageEventHandler | null;
    }

}
