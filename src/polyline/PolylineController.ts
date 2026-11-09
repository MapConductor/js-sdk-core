import { createGeoPoint } from '../features/GeoPoint';
import type { GeoPointInterface } from '../features/GeoPoint';
import { createOverlayHit, type OverlayHit } from '../controller/OverlayHitResolver';
import type { SlottedOverlayController } from '../controller/OverlayController';
import type { OverlayKind } from '../controller/OverlayKind';
import { GeoPoint, wrapClickedPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createPolylineEntity, PolylineEntity } from "./PolylineEntity";
import { PolylineHitResult, PolylineManagerInterface } from "./PolylineManager";
import { PolylineAddParams, PolylineChangeParams, PolylineOverlayRenderer } from "./PolylineOverlayRenderer";
import { OnPolylineEventHandler, PolylineEvent, PolylineState } from "./PolylineState";
import { Mutex } from "../base/Mutex";
import { notifyOverlaysAdded } from "../overlay/OverlayAdded";
import type { PolylineTiler } from "./PolylineTiler";
import { PolylineTileSet } from "./PolylineTileSet";

const NO_IDS: ReadonlySet<string> = new Set();

function fingerPrintsEqual(
    a: ReturnType<PolylineState["fingerPrint"]>,
    b: ReturnType<PolylineState["fingerPrint"]>,
): boolean {
    return (
        a.id === b.id &&
        a.strokeColor === b.strokeColor &&
        a.strokeWidth === b.strokeWidth &&
        a.geodesic === b.geodesic &&
        a.clickable === b.clickable &&
        a.zIndex === b.zIndex &&
        a.points === b.points &&
        a.extra === b.extra
    );
}

export abstract class PolylineController<ActualPolyline>
    implements SlottedOverlayController, OverlayController<PolylineState, PolylineEntity<ActualPolyline>, PolylineEvent>
{
    readonly zIndex: number = 5;
    public readonly polylineManager: PolylineManagerInterface<ActualPolyline>;
    public readonly renderer: PolylineOverlayRenderer<ActualPolyline>;
    public clickListener: OnPolylineEventHandler | null;
    /**
     * Set by a provider that can show polyline tiles (see {@link PolylineTiler}).
     * Polylines it tiles stay in {@link polylineManager}, for taps, with no
     * native overlay: their entity's `polyline` is null and the renderer never
     * sees them.
     */
    public tiler: PolylineTiler | null = null;
    private tiledIds: ReadonlySet<string> = NO_IDS;
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
        // 配送時に wrap して正規化する。理由は PolygonController.dispatchClick を参照。
        const normalized: PolylineEvent = { ...event, clicked: wrapClickedPoint(event.clicked) };
        normalized.state.onClick?.(normalized);
        this.clickListener?.(normalized);
    }

    async composition(data: PolylineState[]): Promise<void> {
        await this.add(data);
    }

    has(state: PolylineState): boolean {
        return this.polylineManager.hasEntity(state.id);
    }

    setOnClickListener(listener: OnPolylineEventHandler | null): void {
        this.clickListener = listener;
    }

    async add(data: PolylineState[]): Promise<void> {
        // Newly on the map; their onAdded runs once the add is done.
        const nowOnMap: PolylineState[] = [];
        await this.semaphore.withLock(async () => {
            const wasTiled = this.tiledIds;
            const tiled = this.tiler ? await this.tiler.route(data) : NO_IDS;
            this.tiledIds = tiled;
            if (tiled.size > 0) data = data.filter((state) => !tiled.has(state.id));
            // Only natively drawn polylines are diffed against the renderer.
            const previous = new Set(
                this.polylineManager
                    .allEntities()
                    .map((e) => e.state.id)
                    .filter((id) => !wasTiled.has(id)),
            );
            // On the map before this add, natively or in tiles. Moving between
            // the two is not an add.
            const nativeBefore = tiled.size > 0 ? new Set(previous) : previous;
            const added: PolylineAddParams[] = [];
            const updated: PolylineChangeParams<ActualPolyline>[] = [];
            const removed: PolylineEntity<ActualPolyline>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.polylineManager.getEntity(state.id)!;
                    previous.delete(state.id);
                    if (fingerPrintsEqual(state.fingerPrint(), prevEntity.fingerPrint)) {
                        // Rendered output is unchanged; adopt the latest state
                        // object (it may carry newer event handlers) without a
                        // renderer round-trip. Recreating the actual overlay on
                        // every composition makes async renderers flicker.
                        this.polylineManager.registerEntity(
                            createPolylineEntity({ polyline: prevEntity.polyline, state }),
                        );
                        continue;
                    }
                    updated.push({
                        current: createPolylineEntity({ polyline: prevEntity.polyline, state }),
                        prev: prevEntity,
                    });
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            // Natively drawn ones that left the list, or moved into the tiles.
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
                        if (!wasTiled.has(added[i].state.id)) nowOnMap.push(added[i].state);
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

            // Tiled polylines: kept for taps, nothing native. Those that left
            // the tiles and the list are forgotten; those that left the tiles
            // for native drawing were added above.
            const nativeIds = wasTiled.size > 0 ? new Set(data.map((state) => state.id)) : NO_IDS;
            for (const id of wasTiled) {
                if (!tiled.has(id) && !nativeIds.has(id) && this.polylineManager.hasEntity(id)) {
                    this.polylineManager.removeEntity(id);
                }
            }
            if (tiled.size > 0) {
                for (const state of this.tiler!.tiledStates()) {
                    // The tiles' template reached the map in route() (onTemplate).
                    if (!wasTiled.has(state.id) && !nativeBefore.has(state.id)) nowOnMap.push(state);
                    this.polylineManager.registerEntity(
                        createPolylineEntity({ polyline: null as unknown as ActualPolyline, state }),
                    );
                }
            }

            await this.renderer.onPostProcess();
        });
        notifyOverlaysAdded(nowOnMap);
    }

    async update(state: PolylineState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.polylineManager.getEntity(state.id);
            if (!prevEntity) return;
            if (this.tiledIds.has(state.id)) {
                if (PolylineTileSet.canTile(state)) {
                    this.polylineManager.registerEntity(createPolylineEntity({ polyline: prevEntity.polyline, state }));
                    this.tiler?.update(state);
                    return;
                }
                // No longer drawable in a tile (geodesic, half the world wide, or
                // under 2 points): the map SDK draws it from now on. Still on the
                // map, so this is not an add. Whether the rest stay in tiles is
                // left to the next add(), which decides tiling for the whole list.
                const tiled = new Set(this.tiledIds);
                tiled.delete(state.id);
                this.tiledIds = tiled;
                this.tiler?.remove(state.id);
                const polylines = await this.renderer.onAdd([{ state }]);
                if (polylines[0] != null) {
                    this.polylineManager.registerEntity(createPolylineEntity({ polyline: polylines[0], state }));
                } else {
                    this.polylineManager.removeEntity(state.id);
                }
                await this.renderer.onPostProcess();
                return;
            }

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
            const tiled = this.tiledIds;
            this.tiledIds = NO_IDS;
            await this.tiler?.clear();
            await this.renderer.onRemove(this.polylineManager.allEntities().filter((e) => !tiled.has(e.state.id)));
            // manager を空にしてから onPostProcess を呼ぶ。GL 系の描画担当は remove では何もせず、
            // onPostProcess で manager の全部を描き直すので、逆の順だと clear() 後も地図に残る。
            this.polylineManager.clear();
            await this.renderer.onPostProcess();
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
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'polyline';

    hasId(id: string): boolean {
        return this.has({ id } as PolylineState);
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.composition(data as PolylineState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as PolylineState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnPolylineEventHandler | null;
    }

    /**
     * ポリラインだけ配送座標がタップ点ではない。**線上の最近傍点**を返す。
     * 線の上をきっかりタップすることはないので、タップ点をそのまま返すと
     * 線から外れた座標がアプリへ渡る。3 プラットフォーム共通の既存契約。
     */
    resolveTap(position: GeoPointInterface): OverlayHit | null {
        const hit = this.findWithClosestPoint(createGeoPoint(position));
        if (hit == null) return null;
        return createOverlayHit('polyline', hit.closestPoint, () =>
            this.dispatchClick({ state: hit.entity.state, clicked: hit.closestPoint }),
        );
    }

}
