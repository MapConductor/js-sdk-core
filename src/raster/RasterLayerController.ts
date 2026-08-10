import type { SlottedOverlayController } from '../controller/OverlayController';
import type { OverlayKind } from '../controller/OverlayKind';
import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createRasterLayerEntity, RasterLayerEntity } from "./RasterLayerEntity";
import { RasterLayerManagerInterface } from "./RasterLayerManager";
import { RasterLayerAddParams, RasterLayerChangeParams, RasterLayerOverlayRenderer } from "./RasterLayerOverlayRenderer";
import { OnRasterLayerEventHandler, RasterLayerEvent, RasterLayerState } from "./RasterLayerState";
import { RasterHeaderRuleSet, RasterHeaderSupport } from "./RasterHeaderRules";
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
        a.extraHeaders === b.extraHeaders
    );
}

export abstract class RasterLayerController<ActualLayer extends object>
    implements SlottedOverlayController, OverlayController<RasterLayerState, RasterLayerEntity<ActualLayer>, RasterLayerEvent>
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

    /**
     * このプロバイダがタイル要求に何を載せられるか。
     *
     * 既定は「載せられない」。宣言し忘れたプロバイダは**黙って無視するのではなく
     * 警告が出る**側に倒しておく（逆にすると、対応していないのに対応しているように見える）。
     * 実際に載せられるプロバイダだけが override して `extraHeaders: true` を宣言する。
     */
    protected get headerSupport(): RasterHeaderSupport {
        return { provider: this.constructor.name, extraHeaders: false };
    }

    /**
     * ヘッダ指定の反映と、載せられない指定の通知。
     *
     * すべてのプロバイダがこの基底クラスを通るので、ここに置けば宣言（[headerSupport]）
     * だけで全プロバイダの挙動が決まる。renderer 側に散らすと、対応していないプロバイダが
     * 「何も書かない」ことで黙って無視する形になり、実装漏れと区別できない。
     */
    private syncHeaders(pending: RasterLayerState[] = []): void {
        const support = this.headerSupport;
        for (const state of pending) RasterHeaderRuleSet.warnUnsupported(support, state);
        if (!support.extraHeaders) return;

        // 描画に入る前の時点では、これから足すレイヤはまだ manager に無い。タイル要求は
        // レイヤを足した直後に飛ぶので、規則の登録が後だと**最初の数枚だけヘッダ無し**に
        // なる。渡された状態を先に混ぜてから登録する。
        const byId = new Map<string, RasterLayerState>();
        for (const entity of this.rasterLayerManager.allEntities()) byId.set(entity.state.id, entity.state);
        for (const state of pending) byId.set(state.id, state);
        RasterHeaderRuleSet.shared.setRules(RasterHeaderRuleSet.makeRules([...byId.values()]), this);
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
        this.syncHeaders(data);
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
        this.syncHeaders();
    }

    async update(state: RasterLayerState): Promise<void> {
        this.syncHeaders([state]);
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
        this.syncHeaders([state]);
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
        this.syncHeaders();
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            this.upsertedIds.clear();
            await this.renderer.onRemove(this.rasterLayerManager.allEntities());
            await this.renderer.onPostProcess();
            this.rasterLayerManager.clear();
        });
        this.syncHeaders();
    }

    find(_position: GeoPoint): RasterLayerEntity<ActualLayer> | null {
        return null;
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        await this.renderer.onCameraChanged(mapCameraPosition);
    }

    destroy(): void {
        RasterHeaderRuleSet.shared.removeRules(this);
    }
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'rasterLayer';

    hasId(id: string): boolean {
        return this.has({ id } as RasterLayerState);
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.composition(data as RasterLayerState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as RasterLayerState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnRasterLayerEventHandler | null;
    }

}
