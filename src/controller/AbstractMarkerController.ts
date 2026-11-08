import type { GeoPointInterface } from '../features/GeoPoint';
import type { OverlayHit } from './OverlayHitResolver';
import type { SlottedOverlayController } from './OverlayController';
import type { OverlayKind } from './OverlayKind';
import { GeoPoint } from "../features";
import { ColorDefaultIcon, fingerPrintEquals, MarkerManager, MarkerState } from "../marker";
import { createMarkerEntity, MarkerEntity } from "../marker";
import { BitmapIcon, MarkerOverlayRenderer } from "../marker";
import { MarkerAnimationOverlayHost } from "../marker";
import { OnMarkerEventHandler } from "../marker";
import { MapCameraPosition } from "../types";
import { ingestMarkers, type MarkerIngestionResult } from "../marker/MarkerIngestionEngine";
import { OverlayController } from "./OverlayController";
import { Mutex } from "../base/Mutex";

/** 続けて来るマーカーの変更を、タイルの描き直し 1 回にまとめる窓。1 フレーム分。 */
const TILE_REFRESH_COALESCE_MS = 16;

export abstract class AbstractMarkerController<ActualMarker>
    implements SlottedOverlayController, OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState>
{
    readonly zIndex: number = 10;
    private defaultIcon: BitmapIcon = new ColorDefaultIcon({ fillColor: "#FF0000" }).toBitmapIcon();
    private readonly draggingStates = new WeakMap<MarkerState, boolean>();
    /** タイル描画中のマーカー ID。android-sdk の各プロバイダが持つ tiledMarkerIds に対応する。 */
    protected readonly tiledMarkerIds = new Set<string>();

    dragStartListener: OnMarkerEventHandler | null = null;
    dragListener: OnMarkerEventHandler | null = null;
    dragEndListener: OnMarkerEventHandler | null = null;
    animateStartListener: OnMarkerEventHandler | null = null;
    animateEndListener: OnMarkerEventHandler | null = null;

    /** 直近のカメラ位置。サブクラスのヒットテスト等が参照する。 */
    protected mapCameraPosition: MapCameraPosition | null = null;
    private semaphore = new Mutex();

    /** 待っているタイルの描き直し（`scheduleTiledMarkersChanged`）。走り始めたら null に戻す。 */
    private pendingTiledRefresh: Promise<void> | null = null;

    public markerManager: MarkerManager<ActualMarker>;
    public renderer: MarkerOverlayRenderer<ActualMarker>;
    public clickListener: OnMarkerEventHandler | null;

    constructor({
        markerManager,
        renderer,
        clickListener = null,
    }: {
        markerManager: MarkerManager<ActualMarker>;
        renderer: MarkerOverlayRenderer<ActualMarker>;
        clickListener?: OnMarkerEventHandler | null;
    }) {
        this.markerManager = markerManager;
        this.renderer = renderer;
        this.clickListener = clickListener;
        this.renderer.animateStartListener = (state) => this.dispatchAnimateStart(state);
        this.renderer.animateEndListener = (state) => this.dispatchAnimateEnd(state);
    }

    /**
     * Nearest-entity lookup. Providers with icon-bounds hit testing
     * (screen-space tolerance) override this.
     */
    find(position: GeoPoint): MarkerEntity<ActualMarker> | null {
        return this.markerManager.findNearest(position);
    }

    async composition(data: MarkerState[]): Promise<void> {
        await this.add(data);
    }

    has(state: MarkerState): boolean {
        return this.markerManager.hasEntity(state.id);
    }

    /** ドラッグできるマーカーがあるか（`MarkerEventHost.hasDraggableMarker`） */
    hasDraggableMarker(): boolean {
        return this.markerManager.hasDraggableEntity();
    }

    setOnClickListener(listener: OnMarkerEventHandler | null): void {
        this.clickListener = listener;
    }

    setOnDragStart(listener: OnMarkerEventHandler | null): void {
        this.dragStartListener = listener;
    }

    setOnDrag(listener: OnMarkerEventHandler | null): void {
        this.dragListener = listener;
    }

    setOnDragEnd(listener: OnMarkerEventHandler | null): void {
        this.dragEndListener = listener;
    }

    setOnAnimateStart(listener: OnMarkerEventHandler | null): void {
        this.animateStartListener = listener;
    }

    setOnAnimateEnd(listener: OnMarkerEventHandler | null): void {
        this.animateEndListener = listener;
    }

    /**
     * Return true if this marker should be rendered as a tile rather than an individual overlay.
     * `totalCount` is the total number of markers in the current composition call.
     */
    protected shouldTile(_state: MarkerState, _totalCount: number): boolean {
        return false;
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

    protected setDraggingState(markerState: MarkerState, dragging: boolean): void {
        this.draggingStates.set(markerState, dragging);
    }

    protected isDragging(markerState: MarkerState): boolean {
        return this.draggingStates.get(markerState) ?? false;
    }

    async add(data: MarkerState[]): Promise<void> {
        // 取り込みロジック本体は MarkerIngestionEngine に集約している（android-sdk / ios-sdk と同じ）。
        // ここに残るのはロック管理と、ロック解放後のアニメーション再生だけ。
        let result: MarkerIngestionResult<ActualMarker> | null = null;
        await this.semaphore.withLock(async () => {
            const totalCount = data.length;
            result = await ingestMarkers<ActualMarker>({
                data,
                markerManager: this.markerManager,
                renderer: this.renderer,
                defaultMarkerIcon: this.defaultIcon,
                // タイル可否の総合判定は shouldTile 側が持つ（有効フラグと件数閾値も含む）ので、
                // engine 側のゲートは常に true にして二重判定を避ける。
                tilingEnabled: true,
                tiledMarkerIds: this.tiledMarkerIds,
                shouldTile: (state) => this.shouldTile(state, totalCount),
                onMarkerAdded: (entity) => this.onMarkerAdded(entity),
            });

            if (result.tiledDataChanged) {
                await this.onTiledMarkersChanged();
            }
        });

        // Play animations OUTSIDE the semaphore, all at once. Awaiting onAnimate
        // under the lock would both block other marker operations and serialize
        // these animations against each other; the screen-space overlay path
        // resolves only when each animation ends. Running them concurrently lets
        // multiple markers drop/bounce simultaneously. See update() for details.
        const toAnimate = (result as MarkerIngestionResult<ActualMarker> | null)?.entitiesToAnimate ?? [];
        if (toAnimate.length > 0) {
            await Promise.all(toAnimate.map((entity) => this.renderer.onAnimate(entity)));
        }
    }

    /** Called when tiled markers are added or updated. Override in subclasses to manage tile overlay. */
    protected async onTiledMarkersChanged(): Promise<void> {
        // no-op by default
    }

    /**
     * 1 本ずつの変更からのタイルの描き直しを、1 フレームに 1 回へまとめる。
     *
     * ラベルの付け替えのように数十本が続けて変わると、1 本ごとに `onTiledMarkersChanged` が
     * 走り、そのたびに全件（街路樹なら 14 万件）を Service Worker へ送り直していた。続けて来た
     * 変更は `TILE_REFRESH_COALESCE_MS` の間に受けて、まとめて 1 回だけ描き直す。
     * android-sdk / ios-sdk の各プロバイダの `scheduleTileRefresh` と同じ。
     */
    private scheduleTiledMarkersChanged(): Promise<void> {
        if (this.pendingTiledRefresh) return this.pendingTiledRefresh;
        const pending = new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                // 走り始めたら次の変更は次の回へ回す。
                this.pendingTiledRefresh = null;
                this.semaphore.withLock(() => this.onTiledMarkersChanged()).then(resolve, reject);
            }, TILE_REFRESH_COALESCE_MS);
        });
        this.pendingTiledRefresh = pending;
        return pending;
    }

    /** Called after a provider marker is created and registered. */
    protected onMarkerAdded(_entity: MarkerEntity<ActualMarker>): void {
        // no-op by default
    }

    async update(state: MarkerState): Promise<void> {
        // Captured inside the lock, animated after it is released (see below).
        let entityToAnimate: MarkerEntity<ActualMarker> | null = null;
        let tiledChanged = false;
        await this.semaphore.withLock(async () => {
            // A composition may remove and recreate this marker while update()
            // is waiting for the lock (for example, when an animation finishes
            // during React StrictMode's effect replay). Always resolve the
            // entity after acquiring the lock so a stale provider marker cannot
            // be written back into MarkerManager.
            const prevEntity = this.markerManager.getEntity(state.id);
            if (!prevEntity) return;

            const currentFinger = state.fingerPrint();
            const prevFinger = prevEntity.fingerPrint;
            if (fingerPrintEquals(currentFinger, prevFinger)) return;

            // 件数だけが要る。allEntities() は全件の写しを作るので、数十本が続けて変わると
            // そのたびに 14 万件を写すことになる。
            const wantsTile = this.shouldTile(state, this.markerManager.getMemoryStats().entityCount);
            // タイル判定は tiledMarkerIds で行う。`marker === null` はプロバイダの onAdd が
            // 失敗して null を返したケースとも一致してしまう。
            const wasTiled = this.tiledMarkerIds.has(state.id);

            if (wantsTile) {
                if (!wasTiled) {
                    await this.renderer.onRemove([prevEntity]);
                }
                this.tiledMarkerIds.add(state.id);
                this.markerManager.updateEntity(createMarkerEntity<ActualMarker>({
                    state,
                    marker: null,
                    isRendered: true,
                    visible: prevEntity.visible,
                    tiling: true,
                }));
                if (!wasTiled) {
                    await this.renderer.onPostProcess();
                }
                tiledChanged = true;
                return;
            }

            const markerIcon = state.icon?.toBitmapIcon() ?? this.defaultIcon;
            const renderEntity = createMarkerEntity<ActualMarker>({
                state,
                marker: prevEntity.marker,
                isRendered: true,
                visible: prevEntity.visible,
            });
            const markers = wasTiled
                ? await this.renderer.onAdd([{ state, bitmapIcon: markerIcon }])
                : await this.renderer.onChange([{
                    current: renderEntity,
                    bitmapIcon: markerIcon,
                    prev: prevEntity,
                }]);

            if (markers.length === 1 && markers[0] != null) {
                const finalEntity = createMarkerEntity<ActualMarker>({
                    state,
                    marker: markers[0],
                    isRendered: true,
                    visible: prevEntity.visible,
                });
                this.markerManager.updateEntity(finalEntity);
                if (wasTiled) {
                    this.tiledMarkerIds.delete(state.id);
                    this.onMarkerAdded(finalEntity);
                }

                if (prevFinger.animation !== currentFinger.animation && state.getAnimation() != null) {
                    entityToAnimate = finalEntity;
                }
            }

            await this.renderer.onPostProcess();
            if (wasTiled) {
                tiledChanged = true;
            }
        });
        if (tiledChanged) await this.scheduleTiledMarkersChanged();

        // Play the animation OUTSIDE the semaphore. For the screen-space overlay
        // path, onAnimate resolves only when the animation finishes (~seconds);
        // awaiting it while holding the lock would serialize every marker's
        // animation (a second marker clicked mid-bounce would wait for the first
        // to end). The overlay animates a bitmap copy of the marker in screen
        // space and does not touch MarkerManager, so it is safe to run unlocked
        // and concurrently with other markers' animations.
        if (entityToAnimate != null) {
            await this.renderer.onAnimate(entityToAnimate);
        }
    }

    async clear(): Promise<void> {
        await this.semaphore.withLock(async () => {
            const entities = this.markerManager.allEntities();
            this.tiledMarkerIds.clear();
            const rendered = entities.filter((entity) => entity.marker !== null);
            if (rendered.length > 0) {
                await this.renderer.onRemove(rendered);
            }
            this.markerManager.clear();
            // 他の 5 種類と同じく、manager を空にしてから onPostProcess を呼ぶ。GL 系の描画担当は
            // onRemove では地図に触らず、onPostProcess で manager の中身から描き直す。
            await this.renderer.onPostProcess();
        });
    }

    // android-sdk の各プロバイダ *MarkerController.onCameraChanged と同じく、直近のカメラ位置を
    // 覚えるだけ。ストラテジ駆動の再描画は StrategyMarkerController（android-sdk と同形）の役目。
    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        this.mapCameraPosition = mapCameraPosition;
    }

    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void {
        this.renderer.animationOverlayHost = host;
    }

    destroy(): void {
        this.tiledMarkerIds.clear();
        this.markerManager.destroy();
    }
    // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
    //
    // kind は**必須メンバ**。宣言を忘れると型エラーになる。既定値を持たせると
    // 「登録したのに composition が黙って捨てられる」という、ビルドも型検査も
    // 通ってしまう不具合になる（android-sdk で実際に踏んだ）。

    readonly kind: OverlayKind = 'marker';

    hasId(id: string): boolean {
        return this.has({ id } as MarkerState);
    }

    async compositionAny(data: unknown[]): Promise<void> {
        await this.composition(data as MarkerState[]);
    }

    async updateAny(state: unknown): Promise<void> {
        await this.update(state as MarkerState);
    }

    setClickListenerAny(listener: unknown): void {
        this.clickListener = listener as OnMarkerEventHandler | null;
    }

    /**
     * マーカーは判定に画面投影が要るのでカスケードの別経路
     * （`BaseMapViewController.dispatchMarkerTap`）で扱う。ここでは当たらない。
     */
    resolveTap(_position: GeoPointInterface): OverlayHit | null {
        return null;
    }

}
