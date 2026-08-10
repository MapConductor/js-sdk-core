import type { SlottedOverlayController } from '../controller/OverlayController';
import type { OverlayKind } from '../controller/OverlayKind';
import { GeoPoint, wrapClickedPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createPolygonEntity, PolygonEntity } from "./PolygonEntity";
import { PolygonManagerInterface } from "./PolygonManager";
import { PolygonAddParams, PolygonChangeParams, PolygonOverlayRenderer } from "./PolygonOverlayRenderer";
import { PolygonEvent, OnPolygonEventHandler, PolygonState } from "./PolygonState";
import { Mutex } from "../base/Mutex";

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
    implements SlottedOverlayController, OverlayController<PolygonState, PolygonEntity<ActualPolygon>, PolygonEvent>
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
        const normalized: PolygonEvent = { ...event, clicked: wrapClickedPoint(event.clicked) };
        normalized.state.onClick?.(normalized);
        this.clickListener?.(normalized);
    }

    async composition(data: PolygonState[]): Promise<void> {
        await this.add(data);
    }

    has(state: PolygonState): boolean {
        return this.polygonManager.hasEntity(state.id);
    }

    setOnClickListener(listener: OnPolygonEventHandler | null): void {
        this.clickListener = listener;
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
                    previous.delete(state.id);
                    if (fingerPrintsEqual(state.fingerPrint(), prevEntity.fingerPrint)) {
                        // Rendered output is unchanged; adopt the latest state
                        // object (it may carry newer event handlers) without a
                        // renderer round-trip. Recreating the actual overlay on
                        // every composition makes async renderers flicker.
                        this.polygonManager.registerEntity(
                            createPolygonEntity({ polygon: prevEntity.polygon, state }),
                        );
                        continue;
                    }
                    updated.push({ current: createPolygonEntity({ polygon: prevEntity.polygon, state }), prev: prevEntity });
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            // android-sdk / ios-sdk と同じ遅延削除: 先にマネージャから取得（まだ忘れない）→
            // onRemove でマップから消してから removeEntity で忘れる。sync が削除途中で
            // 中断されてもマネージャに残るため、次の sync が再試行でき、グラフィックが孤立しない。
            for (const remainId of previous) {
                const e = this.polygonManager.getEntity(remainId);
                if (e) removed.push(e);
            }

            if (removed.length > 0) {
                await this.renderer.onRemove(removed);
                for (const e of removed) this.polygonManager.removeEntity(e.state.id);
            }

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
            // ios-sdk と同じく update() でも onPostProcess を呼んで単一更新をコミットする。
            await this.renderer.onPostProcess();
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
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'polygon';

    hasId(id: string): boolean {
        return this.has({ id } as PolygonState);
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.composition(data as PolygonState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as PolygonState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnPolygonEventHandler | null;
    }

}
