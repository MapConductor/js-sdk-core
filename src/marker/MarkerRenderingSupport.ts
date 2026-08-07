import { createMapServiceKey, type MapServiceKey } from "../map/MapServiceRegistry";
import type { MapViewHolder } from "../map/MapViewHolder";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import { CollectorMarkerOverlayRenderer } from "./CollectorMarkerOverlayRenderer";
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy";
import type { MarkerState } from "./MarkerState";
import { StrategyMarkerController } from "./StrategyMarkerController";

export interface MarkerEventController<ActualMarker> {
    readonly controller?: StrategyMarkerController<ActualMarker>;
    readonly renderer?: MarkerOverlayRenderer<ActualMarker>;
}

/**
 * マーカー描画プラグイン（marker-clustering など）が、マップコントローラ自身に
 * プラグインのインタフェースを実装させずにレンダラ／コントローラを作るための
 * map スコープの capability。
 *
 * android-sdk の `MarkerRenderingSupport.kt` / ios-sdk の `MarkerRenderingSupport.swift`
 * と同じ契約。プロバイダが {@link MarkerRenderingSupportKey} で
 * {@link MutableMapServiceRegistry} に登録し、プラグインがそれを解決する。
 */
export interface MarkerRenderingSupport<ActualMarker> {
    createMarkerRenderer(
        strategy: MarkerRenderingStrategy<ActualMarker>,
    ): MarkerOverlayRenderer<ActualMarker>;

    createMarkerEventController(
        controller: StrategyMarkerController<ActualMarker>,
        renderer: MarkerOverlayRenderer<ActualMarker>,
    ): MarkerEventController<ActualMarker>;

    registerMarkerEventController(controller: MarkerEventController<ActualMarker>): void;

    mapLoadedState?: { value: boolean } | null;

    onMarkerRenderingReady?(): void;
}

/**
 * 型引数を消した {@link MarkerRenderingSupport}。レジストリのキーは 1 つなので、
 * `ActualMarker` の異なる実装を同じキーで出し入れするためにこの別名を使う。
 * ios-sdk の `AnyMarkerRenderingSupport` と同じ役割。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMarkerRenderingSupport = MarkerRenderingSupport<any>;

/**
 * {@link MarkerRenderingSupport} をレジストリから引くためのキー。
 * android-sdk の `object MarkerRenderingSupportKey : MapServiceKey<MarkerRenderingSupport<*>>`、
 * ios-sdk の `enum MarkerRenderingSupportKey: MapServiceKey` に対応する。
 */
export const MarkerRenderingSupportKey: MapServiceKey<AnyMarkerRenderingSupport> =
    createMapServiceKey<AnyMarkerRenderingSupport>();

/**
 * web の各 `react-for-*` が登録する既定の {@link MarkerRenderingSupport}。
 *
 * android-sdk / ios-sdk ではプロバイダごとにネイティブのマーカー型が違うため実装も
 * 分かれるが、web ではクラスタ結果が `MarkerState` のままマーカーコレクタへ入り、
 * そこから先はプロバイダ通常のマーカー経路が処理する。つまり全プロバイダで同じ実装で
 * 足りるので、重複を避けてここに 1 つだけ置く。別の描画経路が要るプロバイダは、
 * 自前の {@link MarkerRenderingSupport} を登録すればよい。
 */
export function createCollectorMarkerRenderingSupport(params: {
    collector: OverlayCollector<MarkerState>;
    holder: MapViewHolder<unknown, unknown> | undefined;
    /** 地図の準備完了状態。クラスタリング開始の合図に使う。 */
    mapLoadedState?: { value: boolean } | null;
    /** 描画準備が整った直後に呼ばれる。初期カメラをオーバーレイへ配る等に使う。 */
    onMarkerRenderingReady?: () => void;
}): MarkerRenderingSupport<MarkerState> {
    const { collector, holder, mapLoadedState = null, onMarkerRenderingReady } = params;
    return {
        createMarkerRenderer: () => new CollectorMarkerOverlayRenderer(collector, holder),

        // クリックはプロバイダ通常のマーカー経路（コレクタから先）で配送されるので、
        // イベントコントローラは空でよい（android-for-maptiler と同じ判断）。
        createMarkerEventController: (controller, renderer) => ({ controller, renderer }),

        registerMarkerEventController: () => {},

        mapLoadedState,

        onMarkerRenderingReady,
    };
}
