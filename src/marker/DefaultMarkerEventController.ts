import type { GeoPoint } from '../features/GeoPoint';
import type { Offset } from '../types/Offset';
import type { MarkerEntity } from './MarkerEntity';
import type { MarkerState } from './MarkerState';
import type { OnMarkerEventHandler } from './OnMarkerEventHandler';

/** ドラッグ開始とみなす移動量（px）。これ未満はタップ扱い。 */
const MARKER_DRAG_THRESHOLD_PX = 3;

/**
 * マーカーのジェスチャの後に来る click を待つ上限（ms）。
 * タッチの click はジェスチャ認識を経て遅れて来るので、0 では足りない。
 */
const SWALLOW_CLICK_WINDOW_MS = 400;

/**
 * ドラッグ処理が地図エンジンに要求する最小の面。
 *
 * maplibre-gl / mapbox-gl の `Map` がそのまま満たす（TomTom Orbis と Longdo web も
 * 内部は maplibre-gl）。core が maplibre-gl に依存しないよう、構造的に切り出してある
 * ——`applyGlMapUISettings` の `GlGestureHandlers` と同じやり方。
 *
 * @internal ドライバー実装点。
 */
export interface GlMarkerDragMap {
    getCanvas(): HTMLCanvasElement;
    getZoom(): number;
    getLayer(id: string): unknown;
    readonly dragPan: { isEnabled(): boolean; enable(): void; disable(): void };
}

/**
 * マーカーのイベント配送に必要な面。
 *
 * android-sdk の `MarkerEventHostInterface` に対応する。
 * ネイティブのマーカー型に触れずに、ドラッグの状態遷移だけを扱えるようにするための面。
 *
 * @internal ドライバー実装点。
 */
export interface MarkerEventHost<ActualMarker> {
    clickListener: OnMarkerEventHandler | null;
    dragStartListener: OnMarkerEventHandler | null;
    dragListener: OnMarkerEventHandler | null;
    dragEndListener: OnMarkerEventHandler | null;
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;

    /** ドラッグを開始できるマーカーの引き当て。アイコンの矩形＋許容量で判定する。 */
    findWithZoom(
        position: GeoPoint | null,
        zoom: number,
        pointerType: 'touch' | 'mouse',
    ): MarkerEntity<ActualMarker> | null;

    /**
     * ドラッグできるマーカーが 1 つでもあるか。
     *
     * false を返すと、`pointerdown` でマーカーを引き当てない（掴めるものが無いので結果は
     * 使われない）。引き当ては空間インデックスを使うので、マーカーを差し替えた直後は
     * その再構築を待つことになり、地図を触った瞬間に止まって見える。
     * 実装しない host は従来どおり毎回引き当てる。
     */
    hasDraggableMarker?(): boolean;

    getSelectedMarker(): MarkerEntity<ActualMarker> | null;
    setSelectedMarker(entity: MarkerEntity<ActualMarker> | null): void | Promise<void>;
    updateSelectedPosition(position: GeoPoint | null): void;

    dispatchClick(state: MarkerState): void;

    /**
     * 地図のタップの入口（`BaseMapViewController.dispatchTap`）。marker → オーバーレイ →
     * 地図クリックの順に 1 つだけ配送する。
     *
     * `clickable: false` のマーカーをタップしたとき、そのタップを下へ流すのに使う。
     * `BaseMapViewController.registerOverlayController` が設定するので、ドライバーは
     * 何も書かなくてよい。null（未登録）なら流さない。
     */
    mapTapDispatcher?: ((position: GeoPoint) => void) | null;

    dispatchDragStart(state: MarkerState): void;
    dispatchDrag(state: MarkerState): void;
    dispatchDragEnd(state: MarkerState): void;

    /** 画面座標 ⇄ 地理座標。ドラッグ中の位置解決に使う。 */
    readonly renderer: {
        readonly holder: {
            readonly map: GlMarkerDragMap;
            fromScreenOffsetSync(offset: Offset): GeoPoint | null;
        };
        readonly markerLayer: { readonly layerId: string };
    };
}

/**
 * マーカーのイベント配送とドラッグの状態遷移。
 *
 * ## 何をするクラスか
 *
 * ポインタ入力（ドライバー側）とマーカーコントローラ（コア側）の間に立って、
 *  - ドラッグの開始・移動・終了の配送
 *  - ドラッグ中のマーカーの保持
 *  - ドラッグ中の地図パン抑止と、**掴む前の値への復元**
 *  - アプリが設定した非推奨リスナーの転送
 * を行う。**地図 SDK の型に一切触らない**ので、プロバイダごとに書く必要が無い。
 *
 * ## 移行前
 *
 * react-for-maplibre / mapbox / maptiler / tomtom / longdo が
 * `*MarkerEventController` を 165 行ずつ持っており、**型名以外は 1 文字も違わなかった**
 * （diff を取って確認済み）。825 行が 1 本になる。
 *
 * ## パン抑止は「掴む前の値へ戻す」こと
 *
 * `dragPan` を無条件に `enable()` すると、アプリが `uiSettings.scrollGesture = false`
 * にしていた地図がドラッグ後に動くようになってしまう。掴んだ時点の値を覚えて戻す。
 *
 * @internal ドライバー実装点。
 */
export class DefaultMarkerEventController<ActualMarker> {
    private activePointerId: number | null = null;
    private dragPanWasEnabled = false;
    private pointerDownOffset: Offset | null = null;
    private dragStarted = false;

    /** 直近のポインタ種別。タイル方式マーカーの当たり半径をビュー側が変えるのに使う。 */
    lastPointerType: 'touch' | 'mouse' = 'mouse';

    constructor(protected readonly host: MarkerEventHost<ActualMarker>) {
        const canvas = this.canvas;
        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        canvas.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('pointercancel', this.handlePointerCancel);
    }

    private get map(): GlMarkerDragMap {
        return this.host.renderer.holder.map;
    }

    private get canvas(): HTMLCanvasElement {
        return this.map.getCanvas();
    }

    resync(): void {
        // マーカーのクリックはビュー側（map の click → dispatchTap）で処理する。
    }

    setClickListener(listener: OnMarkerEventHandler | null): void {
        this.host.clickListener = listener;
    }

    setDragStartListener(listener: OnMarkerEventHandler | null): void {
        this.host.dragStartListener = listener;
    }

    setDragListener(listener: OnMarkerEventHandler | null): void {
        this.host.dragListener = listener;
    }

    setDragEndListener(listener: OnMarkerEventHandler | null): void {
        this.host.dragEndListener = listener;
    }

    setAnimateStartListener(listener: OnMarkerEventHandler | null): void {
        this.host.animateStartListener = listener;
    }

    setAnimateEndListener(listener: OnMarkerEventHandler | null): void {
        this.host.animateEndListener = listener;
    }

    destroy(): void {
        const canvas = this.canvas;
        canvas.removeEventListener('pointerdown', this.handlePointerDown);
        canvas.removeEventListener('pointermove', this.handlePointerMove);
        canvas.removeEventListener('pointerup', this.handlePointerUp);
        canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    }

    private readonly handlePointerDown = (event: PointerEvent): void => {
        this.lastPointerType = event.pointerType === 'touch' ? 'touch' : 'mouse';
        if (!event.isPrimary || event.button !== 0 || this.activePointerId != null) return;
        // 掴めるマーカーが無ければ引き当てない（地図のパンのたびに走るため）
        if (this.host.hasDraggableMarker?.() === false) return;
        const entity = this.findMarkerAtPointer(event);
        if (!entity?.state.draggable) return;

        event.preventDefault();
        this.activePointerId = event.pointerId;
        this.pointerDownOffset = this.localPoint(event);
        this.dragStarted = false;
        // 掴む前の値を覚える。無条件に enable() すると、パンを切ってある地図が
        // ドラッグ後に動くようになってしまう。
        this.dragPanWasEnabled = this.map.dragPan.isEnabled();
        this.map.dragPan.disable();
        this.canvas.setPointerCapture(event.pointerId);
        void this.host.setSelectedMarker(entity);
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        const selected = this.host.getSelectedMarker();
        if (!selected) return;

        event.preventDefault();
        if (!this.dragStarted) {
            const down = this.pointerDownOffset;
            const current = this.localPoint(event);
            if (!down || Math.hypot(current.x - down.x, current.y - down.y) < MARKER_DRAG_THRESHOLD_PX) {
                return;
            }
            this.dragStarted = true;
            this.host.dispatchDragStart(selected.state);
        }
        const position = this.positionFromPointer(event);
        if (position == null) return;
        selected.state.setPosition(position);
        this.host.updateSelectedPosition(position);
        this.host.dispatchDrag(selected.state);
    };

    private readonly handlePointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        // pointerup と同じタスクで来る click を、地図に届く前に止める。ここ（同期部分）で
        // 張らないと間に合わない。
        this.swallowNextClick();
        void this.finishDrag(event, true);
    };

    private readonly handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        void this.finishDrag(event, false);
    };

    private async finishDrag(event: PointerEvent, updatePosition: boolean): Promise<void> {
        const selected = this.host.getSelectedMarker();
        if (!selected) {
            this.restoreMapInteraction(event.pointerId);
            return;
        }

        const wasDragging = this.dragStarted;
        if (updatePosition && wasDragging) {
            const position = this.positionFromPointer(event);
            if (position != null) {
                selected.state.setPosition(position);
                this.host.updateSelectedPosition(position);
            }
        }
        await this.host.setSelectedMarker(null);
        if (wasDragging) {
            this.host.dispatchDragEnd(selected.state);
        } else if (updatePosition) {
            // A press and release that never passed the drag threshold is a tap,
            // and this is the only place that reports it. `preventDefault()` on
            // pointerdown stops the compatibility mousedown/mouseup but not the
            // browser's click; that click is swallowed in handlePointerUp, because
            // whether the map engine turns it into a tap is up to the engine
            // (maplibre-gl drops a click far from the last mousedown it saw, and it
            // never saw this one). So the tap is delivered from here, once:
            //  - clickable: the marker's onClick;
            //  - not clickable: through the map's own cascade, as on Android, where
            //    the tap is the native map click and dispatchTap skips markers that
            //    are not clickable — the polygon under a vertex handle gets it, or
            //    the map click if nothing is there.
            // Not dispatched for `pointercancel`, which is the gesture being taken
            // away rather than completed.
            if (selected.state.clickable) {
                this.host.dispatchClick(selected.state);
            } else {
                const position = this.positionFromPointer(event);
                if (position != null) this.host.mapTapDispatcher?.(position);
            }
        }
        this.restoreMapInteraction(event.pointerId);
    }

    /**
     * 次の 1 回の `click` を、地図に届く前に捨てる。
     *
     * マーカーを掴んだジェスチャはマーカーのもので、タップの配送は
     * {@link finishDrag} が 1 回だけ行う。ブラウザの click まで地図へ流すと、
     * ドラッグを離した点のポリゴンに onClick が飛び、clickable なマーカーの
     * タップで onClick が 2 回になる。maplibre-gl 自身がドラッグ後にやっている
     * こと（`DOM.suppressClick`）と同じ。
     *
     * 外すのは、捨てたとき・次のジェスチャの pointerdown・短い猶予のうち最初のもの。
     * マウスの click は pointerup と同じタスクで来るが、タッチの click は
     * ジェスチャ認識を経てから来るので、0 ms の猶予では間に合わないことがある。
     * 次の pointerdown で外すので、続くタップの click を捨てることは無い。
     */
    private swallowNextClick(): void {
        const view = this.canvas.ownerDocument?.defaultView;
        if (!view) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const release = (): void => {
            view.removeEventListener('click', swallow, true);
            view.removeEventListener('pointerdown', release, true);
            if (timer != null) clearTimeout(timer);
            timer = null;
        };
        const swallow = (click: Event): void => {
            click.preventDefault();
            click.stopPropagation();
            release();
        };
        view.addEventListener('click', swallow, true);
        view.addEventListener('pointerdown', release, true);
        timer = setTimeout(release, SWALLOW_CLICK_WINDOW_MS);
    }

    private restoreMapInteraction(pointerId: number): void {
        const canvas = this.canvas;
        if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        // **掴む前の値へ戻す。** 無条件に enable() しないこと。
        if (this.dragPanWasEnabled) this.map.dragPan.enable();
        this.dragPanWasEnabled = false;
        this.activePointerId = null;
        this.pointerDownOffset = null;
        this.dragStarted = false;
    }

    private findMarkerAtPointer(event: PointerEvent): MarkerEntity<ActualMarker> | null {
        if (!this.map.getLayer(this.host.renderer.markerLayer.layerId)) return null;
        // アイコンの矩形（icon が null なら既定サイズ）で判定する。
        // 1 ピクセルの queryRenderedFeatures だと、描画済みのピクセルにきっかり
        // 当てないと掴めず、アイコンの大きさも無視される。
        const position = this.host.renderer.holder.fromScreenOffsetSync(this.localPoint(event));
        return this.host.findWithZoom(position, this.map.getZoom(), this.lastPointerType);
    }

    private positionFromPointer(event: PointerEvent): GeoPoint | null {
        return this.host.renderer.holder.fromScreenOffsetSync(this.localPoint(event));
    }

    private localPoint(event: PointerEvent): Offset {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
}
