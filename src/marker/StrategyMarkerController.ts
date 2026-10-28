import type { GeoPointInterface } from '../features/GeoPoint';
import type { OverlayHit } from '../controller/OverlayHitResolver';
import type { SlottedOverlayController } from '../controller/OverlayController';
import type { OverlayKind } from '../controller/OverlayKind';
import { GeoPoint, GeoRectBounds } from "../features";
import type { OverlayController } from "../controller/OverlayController";
import { MapCameraPosition, Offset } from "../types";
import { Settings } from "../settings";
import { Mutex } from "../base/Mutex";
import { markerIconExtentPx } from "./MarkerIconExtent";
import { markerSearchBounds, pickMarkerHit } from "./MarkerHitPick";
import { createDefaultIcon } from "./ColorDefaultIcon";
import { MarkerEntity } from "./MarkerEntity";
import { MarkerManager } from "./MarkerManager";
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy";
import { MarkerState } from "./MarkerState";
import { OnMarkerEventHandler } from "./OnMarkerEventHandler";

/**
 * Strategy-driven marker controller.
 *
 * Mirrors `StrategyMarkerController.kt` (android-sdk-core) /
 * `StrategyMarkerController.swift` (ios-sdk-core): camera bounds are remembered
 * via `lastKnownBounds` so add/update keep working between camera events, states
 * received before the first camera fix are queued in `pendingStates`, and
 * `find()` hit-tests the tapped point against the nearest marker's icon bounds
 * with `Settings.Default.tapTolerance`.
 */
export class StrategyMarkerController<ActualMarker>
    implements SlottedOverlayController, OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState>
{
    readonly markerManager: MarkerManager<ActualMarker>;
    readonly zIndex: number = 10;
    private mapCameraPosition: MapCameraPosition | null = null;
    private lastKnownBounds: GeoRectBounds | null = null;
    private readonly semaphore = new Mutex();
    private pendingStates: MarkerState[] | null = null;

    dragStartListener: OnMarkerEventHandler | null = null;
    dragListener: OnMarkerEventHandler | null = null;
    dragEndListener: OnMarkerEventHandler | null = null;
    animateStartListener: OnMarkerEventHandler | null = null;
    animateEndListener: OnMarkerEventHandler | null = null;

    private readonly strategy: MarkerRenderingStrategy<ActualMarker>;
    private readonly renderer: MarkerOverlayRenderer<ActualMarker>;
    public clickListener: OnMarkerEventHandler | null;

    constructor({
        strategy,
        renderer,
        clickListener = null,
    }: {
        strategy: MarkerRenderingStrategy<ActualMarker>;
        renderer: MarkerOverlayRenderer<ActualMarker>;
        clickListener?: OnMarkerEventHandler | null;
    }) {
        this.strategy = strategy;
        this.renderer = renderer;
        this.clickListener = clickListener;
        this.markerManager = strategy.markerManager;
        this.renderer.animateStartListener = (state) => this.dispatchAnimateStart(state);
        this.renderer.animateEndListener = (state) => this.dispatchAnimateEnd(state);
    }

    /**
     * クリックを配送する。
     *
     * `clickable=false` のマーカーには配送しない。各プロバイダのクリック経路が
     * 先に弾いているが、ネイティブのクリックリスナー経由など
     * ヒットテストを通らない経路もあるため、出口でも守る。
     */
    dispatchClick(state: MarkerState): void {
        if (!state.clickable) return;
        state.onClick?.(state);
        this.clickListener?.(state);
    }

    dispatchDragStart(state: MarkerState): void {
        state.onDragStart?.(state);
        this.dragStartListener?.(state);
    }

    dispatchDrag(state: MarkerState): void {
        state.onDrag?.(state);
        this.dragListener?.(state);
    }

    dispatchDragEnd(state: MarkerState): void {
        state.onDragEnd?.(state);
        this.dragEndListener?.(state);
    }

    dispatchAnimateStart(state: MarkerState): void {
        state.onAnimateStart?.(state);
        this.animateStartListener?.(state);
    }

    dispatchAnimateEnd(state: MarkerState): void {
        state.onAnimateEnd?.(state);
        this.animateEndListener?.(state);
    }

    async add(data: MarkerState[]): Promise<void> {
        const bounds = this.mapCameraPosition?.visibleRegion?.bounds ?? this.lastKnownBounds;
        if (bounds == null) {
            this.pendingStates = data;
            return;
        }
        await this.semaphore.withLock(async () => {
            await this.strategy.onAdd({ data, viewport: bounds, renderer: this.renderer });
        });
    }

    async update(state: MarkerState): Promise<void> {
        const bounds = this.mapCameraPosition?.visibleRegion?.bounds ?? this.lastKnownBounds;
        if (bounds == null) return;
        await this.semaphore.withLock(async () => {
            await this.strategy.onUpdate({ state, viewport: bounds, renderer: this.renderer });
        });
    }

    async clear(): Promise<void> {
        // Release the renderer's per-marker resources (icon images / sprites)
        // before dropping the entities. strategy.clear() only clears the manager's
        // bookkeeping and never calls onRemove, so without this the GL providers'
        // reference-counted icon images and Azure's sprite images would stay
        // registered on the map after an explicit clear() while the map is alive.
        const entities = this.strategy.markerManager.allEntities();
        if (entities.length > 0) {
            await this.renderer.onRemove(entities);
        }
        this.strategy.clear();
    }

    getEntity(id: string): MarkerEntity<ActualMarker> | null {
        return this.strategy.markerManager.getEntity(id);
    }

    find(position: GeoPoint): MarkerEntity<ActualMarker> | null {
        const holder = this.renderer.holder;
        if (holder == null) return this.strategy.markerManager.findNearest(position);

        const touchScreen = this.resolveSyncOffset(holder.toScreenOffset(position));
        // Screen projection only resolves asynchronously on this holder; the
        // native icon-bounds hit test needs synchronous offsets, so degrade to
        // the geo-nearest result instead of dropping the hit entirely.
        if (touchScreen === undefined) return this.strategy.markerManager.findNearest(position);
        if (touchScreen === null) return null;

        // android-sdk / ios-sdk の StrategyMarkerController.find と同じ。タップ点の周りのマーカーを
        // 候補にし、指の下にアイコン（ラベル込み）が描かれているものを優先する（pickMarkerHit）。
        const project = (p: GeoPointInterface): Offset | null =>
            this.resolveSyncOffset(holder.toScreenOffset(p as GeoPoint)) ?? null;
        const bounds = markerSearchBounds(position, touchScreen, project);
        if (!bounds) return null;

        // Native multiplies tapTolerance (dp) by the display density; on the
        // web both tolerance and offsets are CSS pixels, so no scaling applies.
        const tolerancePx = Settings.Default.tapTolerance;
        const hit = pickMarkerHit(
            touchScreen,
            this.strategy.markerManager.findMarkersInBounds(bounds),
            entity => {
                const anchorScreen = project(entity.state.position);
                if (!anchorScreen) return null;
                const icon = entity.state.icon ?? createDefaultIcon();
                // 既定アイコンはラベルの分だけビットマップがピン本体より広い。anchor はその
                // ビットマップに対する割合なので、矩形も実寸で取る（android / iOS の MarkerHitTest と同じ）。
                const extent = markerIconExtentPx(icon);
                return { anchorScreen, width: extent.width, height: extent.height, anchor: icon.anchor };
            },
            tolerancePx,
        );
        return hit?.item ?? null;
    }

    /** `undefined` means the holder projects asynchronously (no sync value available). */
    private resolveSyncOffset(
        result: Offset | null | Promise<Offset | null>,
    ): Offset | null | undefined {
        if (result != null && typeof (result as Promise<Offset | null>).then === "function") {
            return undefined;
        }
        return result as Offset | null;
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        this.mapCameraPosition = mapCameraPosition;
        const bounds = mapCameraPosition.visibleRegion?.bounds;
        if (bounds != null) this.lastKnownBounds = bounds;
        await this.semaphore.withLock(async () => {
            await this.strategy.onCameraChanged(mapCameraPosition, this.renderer);
        });
        const pending = this.pendingStates;
        if (pending == null) return;
        this.pendingStates = null;
        await this.add(pending);
    }

    destroy(): void {
        this.strategy.clear();
    }
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'marker';

    hasId(id: string): boolean {
        return this.getEntity(id) != null;
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.add(data as MarkerState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as MarkerState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnMarkerEventHandler | null;
    }

    /** マーカーは別経路（`dispatchMarkerTap`）。ここでは当たらない。 */
    resolveTap(_position: GeoPointInterface): OverlayHit | null {
        return null;
    }

}
