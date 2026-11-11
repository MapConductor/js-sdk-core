import { createGeoPoint } from '../features/GeoPoint';
import type { GeoPointInterface } from '../features/GeoPoint';
import { createOverlayHit, type OverlayHit } from '../controller/OverlayHitResolver';
import type { SlottedOverlayController } from '../controller/OverlayController';
import type { OverlayKind } from '../controller/OverlayKind';
import { GeoPoint, wrapClickedPoint } from "../features";
import { MapCameraPosition } from "../types";
import { OverlayController } from "../controller/OverlayController";
import { createCircleEntity, CircleEntity } from "./CircleEntity";
import { CircleManagerInterface } from "./CircleManager";
import { CircleAddParams, CircleChangeParams, CircleOverlayRenderer } from "./CircleOverlayRenderer";
import { CircleEvent, CircleState, OnCircleEventHandler } from "./CircleState";
import { Mutex } from "../base/Mutex";
import { notifyOverlaysAdded } from "../overlay/OverlayAdded";
import type { CircleTiler } from "./CircleTiler";
import { CircleTileSet } from "./CircleTileSet";

const NO_IDS: ReadonlySet<string> = new Set();

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
    implements SlottedOverlayController, OverlayController<CircleState, CircleEntity<ActualCircle>, CircleEvent>
{
    // Above the polygons (3), under the polylines (5): OVERLAY_STACK_ORDER.
    readonly zIndex: number = 4;
    public readonly circleManager: CircleManagerInterface<ActualCircle>;
    public readonly renderer: CircleOverlayRenderer<ActualCircle>;
    public clickListener: OnCircleEventHandler | null;
    /**
     * Set by a provider that can show circle tiles (see {@link CircleTiler}).
     * Circles it tiles stay in {@link circleManager}, for taps, with no native
     * overlay: their entity's `circle` is null and the renderer never sees them.
     */
    public tiler: CircleTiler | null = null;
    private nativeEntities(): CircleEntity<ActualCircle>[] {
        return this.circleManager.nativeEntities?.() ?? this.circleManager.allEntities().filter(e => e.circle != null);
    }

    private unchanged(state: CircleState, entity: CircleEntity<ActualCircle>): boolean {
        if (state === entity.state && state.revision !== undefined && entity.appliedRevision !== undefined) {
            return state.revision === entity.appliedRevision || ((state.changedFields ?? 0x1ff) & 0x1ff) === 0;
        }
        return fingerPrintsEqual(state.fingerPrint(), entity.fingerPrint);
    }
    private tiledIds: ReadonlySet<string> = NO_IDS;
    private semaphore = new Mutex();
    private currentCameraPosition: MapCameraPosition | null = null;

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
        // 配送時に wrap して正規化する。理由は PolygonController.dispatchClick を参照。
        const normalized: CircleEvent = { ...event, clicked: wrapClickedPoint(event.clicked) };
        normalized.state.onClick?.(normalized);
        this.clickListener?.(normalized);
    }

    async composition(data: CircleState[]): Promise<void> {
        await this.add(data);
    }

    has(state: CircleState): boolean {
        return this.circleManager.hasEntity(state.id);
    }

    setOnClickListener(listener: OnCircleEventHandler | null): void {
        this.clickListener = listener;
    }

    async add(data: CircleState[]): Promise<void> {
        // Newly on the map; their onAdded runs once the add is done.
        const nowOnMap: CircleState[] = [];
        await this.semaphore.withLock(async () => {
            const wasTiled = this.tiledIds;
            const tiled = this.tiler ? await this.tiler.route(data) : NO_IDS;
            const sharedTiles = this.circleManager.setTiledSource?.(this.tiler) ?? false;
            this.tiledIds = tiled;
            if (tiled.size > 0) data = data.filter((state) => !tiled.has(state.id));
            // Only natively drawn circles are diffed against the renderer.
            const previous = new Set(
                this.nativeEntities()
                    .map((e) => e.state.id)
                    .filter((id) => !wasTiled.has(id)),
            );
            // On the map before this add, natively or in tiles. Moving between
            // the two is not an add.
            const nativeBefore = tiled.size > 0 ? new Set(previous) : previous;
            const added: CircleAddParams[] = [];
            const updated: CircleChangeParams<ActualCircle>[] = [];
            const removed: CircleEntity<ActualCircle>[] = [];

            for (const state of data) {
                if (previous.has(state.id)) {
                    const prevEntity = this.circleManager.getEntity(state.id)!;
                    previous.delete(state.id);
                    if (this.unchanged(state, prevEntity)) {
                        // Rendered output is unchanged; adopt the latest state
                        // object (it may carry newer event handlers) without a
                        // renderer round-trip. Recreating the actual overlay on
                        // every composition makes async renderers flicker.
                        this.circleManager.registerEntity(
                            createCircleEntity({ circle: prevEntity.circle, state }),
                        );
                        continue;
                    }
                    updated.push({ current: createCircleEntity({ circle: prevEntity.circle, state }), prev: prevEntity });
                } else {
                    added.push({ state });
                    previous.delete(state.id);
                }
            }

            // Natively drawn ones that left the list, or moved into the tiles.
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
                        if (!wasTiled.has(added[i].state.id)) nowOnMap.push(added[i].state);
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

            // Tiled circles: kept for taps, nothing native. Those that left the
            // tiles and the list are forgotten; those that left the tiles for
            // native drawing were added above.
            const nativeIds = wasTiled.size > 0 ? new Set(data.map((state) => state.id)) : NO_IDS;
            for (const id of wasTiled) {
                if (!tiled.has(id) && !nativeIds.has(id) && this.circleManager.hasEntity(id)) {
                    this.circleManager.removeEntity(id);
                }
            }
            if (tiled.size > 0) {
                for (const state of this.tiler!.tiledStates()) {
                    // The tiles' template reached the map in route() (onTemplate).
                    if (!wasTiled.has(state.id) && !nativeBefore.has(state.id)) nowOnMap.push(state);
                    if (!sharedTiles) this.circleManager.registerEntity(
                        createCircleEntity({ circle: null as unknown as ActualCircle, state }),
                    );
                }
            }

            await this.renderer.onPostProcess();
        });
        notifyOverlaysAdded(nowOnMap);
    }

    async update(state: CircleState): Promise<void> {
        await this.semaphore.withLock(async () => {
            const prevEntity = this.circleManager.getEntity(state.id);
            if (!prevEntity) return;
            if (this.tiledIds.has(state.id)) {
                if (CircleTileSet.canTile(state)) {
                    this.circleManager.registerEntity(createCircleEntity({ circle: prevEntity.circle, state }));
                    this.tiler?.update(state);
                    return;
                }
                // No longer drawable in a tile (over a pole or the antimeridian, or
                // no radius): the map SDK draws it from now on. Still on the map, so
                // this is not an add. Whether the rest stay in tiles is left to the
                // next add(), which decides tiling for the whole list.
                const tiled = new Set(this.tiledIds);
                tiled.delete(state.id);
                this.tiledIds = tiled;
                this.tiler?.remove(state.id);
                const circles = await this.renderer.onAdd([{ state }]);
                if (circles[0] != null) {
                    this.circleManager.registerEntity(createCircleEntity({ circle: circles[0], state }));
                } else {
                    this.circleManager.removeEntity(state.id);
                }
                await this.renderer.onPostProcess();
                return;
            }

            if (this.unchanged(state, prevEntity)) return;

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
            // android-sdk / ios-sdk と同じく update() でも onPostProcess を呼んで
            // 単一更新を確実にコミット/フラッシュする。
            await this.renderer.onPostProcess();
        });
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            const tiled = this.tiledIds;
            this.tiledIds = NO_IDS;
            await this.tiler?.clear();
            await this.renderer.onRemove(this.nativeEntities().filter((e) => !tiled.has(e.state.id)));
            // manager を空にしてから onPostProcess を呼ぶ。GL 系の描画担当は remove では何もせず、
            // onPostProcess で manager の全部を描き直すので、逆の順だと clear() 後も地図に残る。
            this.circleManager.clear();
            await this.renderer.onPostProcess();
        });
    }

    find(position: GeoPoint): CircleEntity<ActualCircle> | null {
        // The camera's zoom turns the outline's CSS pixels into metres.
        return this.circleManager.find(position, this.currentCameraPosition);
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        this.currentCameraPosition = mapCameraPosition;
    }

    destroy(): void {
        // No native resources to clean up for circles
    }
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'circle';

    hasId(id: string): boolean {
        return this.has({ id } as CircleState);
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.composition(data as CircleState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as CircleState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnCircleEventHandler | null;
    }

    resolveTap(position: GeoPointInterface): OverlayHit | null {
        const point = createGeoPoint(position);
        const entity = this.find(point);
        if (entity == null) return null;
        return createOverlayHit('circle', point, () =>
            this.dispatchClick({ state: entity.state, clicked: point }),
        );
    }

}
