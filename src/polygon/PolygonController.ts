import { createGeoPoint } from '../features/GeoPoint';
import type { GeoPointInterface } from '../features/GeoPoint';
import { createOverlayHit, type OverlayHit } from '../controller/OverlayHitResolver';
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
import { notifyOverlaysAdded } from "../overlay/OverlayAdded";
import type { PolygonTiler } from "./PolygonTiler";
import { PolygonTileSet } from "./PolygonTileSet";

const NO_IDS: ReadonlySet<string> = new Set();

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
        a.clickable === b.clickable &&
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
    /**
     * Set by a provider that can show polygon tiles (see {@link PolygonTiler}).
     * Polygons it tiles stay in {@link polygonManager}, for taps, with no
     * native overlay: their entity's `polygon` is null and the renderer never
     * sees them.
     */
    public tiler: PolygonTiler | null = null;
    private tiledIds: ReadonlySet<string> = NO_IDS;
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
        // Newly on the map; their onAdded runs once the add is done.
        const nowOnMap: PolygonState[] = [];
        await this.semaphore.withLock(async () => {
            const wasTiled = this.tiledIds;
            const tiled = this.tiler ? await this.tiler.route(data) : NO_IDS;
            this.tiledIds = tiled;
            if (tiled.size > 0) data = data.filter((state) => !tiled.has(state.id));
            // Only natively drawn polygons are diffed against the renderer.
            const previous = new Set(
                this.polygonManager
                    .allEntities()
                    .map((e) => e.state.id)
                    .filter((id) => !wasTiled.has(id)),
            );
            // On the map before this add, natively or in tiles. Moving between
            // the two is not an add.
            const nativeBefore = tiled.size > 0 ? new Set(previous) : previous;
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
                        if (!wasTiled.has(added[i].state.id)) nowOnMap.push(added[i].state);
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

            // Tiled polygons: kept for taps, nothing native. Those that left
            // the tiles and the list are forgotten; those that left the tiles
            // for native drawing were added above.
            const nativeIds = wasTiled.size > 0 ? new Set(data.map((state) => state.id)) : NO_IDS;
            for (const id of wasTiled) {
                if (!tiled.has(id) && !nativeIds.has(id) && this.polygonManager.hasEntity(id)) {
                    this.polygonManager.removeEntity(id);
                }
            }
            if (tiled.size > 0) {
                for (const state of this.tiler!.tiledStates()) {
                    // The tiles' template reached the map in route() (onTemplate).
                    if (!wasTiled.has(state.id) && !nativeBefore.has(state.id)) nowOnMap.push(state);
                    this.polygonManager.registerEntity(
                        createPolygonEntity({ polygon: null as unknown as ActualPolygon, state }),
                    );
                }
            }

            await this.renderer.onPostProcess();
        });
        notifyOverlaysAdded(nowOnMap);
    }

    async update(state: PolygonState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.polygonManager.getEntity(state.id);
            if (!prevEntity) return;
            if (this.tiledIds.has(state.id)) {
                if (PolygonTileSet.canTile(state)) {
                    this.polygonManager.registerEntity(createPolygonEntity({ polygon: prevEntity.polygon, state }));
                    this.tiler?.update(state);
                    return;
                }
                // No longer drawable in a tile (geodesic, half the world wide, or
                // under 3 points): the map SDK draws it from now on. Still on the
                // map, so this is not an add. Whether the rest stay in tiles is
                // left to the next add(), which decides tiling for the whole list.
                const tiled = new Set(this.tiledIds);
                tiled.delete(state.id);
                this.tiledIds = tiled;
                this.tiler?.remove(state.id);
                const polygons = await this.renderer.onAdd([{ state }]);
                if (polygons[0] != null) {
                    this.polygonManager.registerEntity(createPolygonEntity({ polygon: polygons[0], state }));
                } else {
                    this.polygonManager.removeEntity(state.id);
                }
                await this.renderer.onPostProcess();
                return;
            }

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
            const tiled = this.tiledIds;
            this.tiledIds = NO_IDS;
            await this.tiler?.clear();
            await this.renderer.onRemove(this.polygonManager.allEntities().filter((e) => !tiled.has(e.state.id)));
            // manager を空にしてから onPostProcess を呼ぶ。GL 系の描画担当は remove では何もせず、
            // onPostProcess で manager の全部を描き直すので、逆の順だと clear() 後も地図に残る。
            this.polygonManager.clear();
            await this.renderer.onPostProcess();
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

    resolveTap(position: GeoPointInterface): OverlayHit | null {
        const point = createGeoPoint(position);
        const entity = this.find(point);
        if (entity == null) return null;
        return createOverlayHit('polygon', point, () =>
            this.dispatchClick({ state: entity.state, clicked: point }),
        );
    }

}
