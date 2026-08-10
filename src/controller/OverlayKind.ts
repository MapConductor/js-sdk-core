/**
 * オーバーレイの種別。
 *
 * {@link BaseMapViewController} が Capable ファサード（`compositionXxx` / `updateXxx` /
 * `hasXxx`）の既定実装で、登録済みの {@link OverlayController} を振り分けるのに使う。
 *
 * TypeScript のジェネリクスは実行時に消えるので状態の型では判別できない。
 * かといってコンストラクタを持たせると、状態型がプロバイダ固有になったときに破綻する。
 * 種別という別の軸で持つ。
 *
 * **描画順（zIndex）とは別軸**であることに注意。現状 polygon(3) > groundImage(2) だが、
 * クリックの探索は groundImage が先。
 *
 * android-sdk / ios-sdk にも同名・同じ並びで置く。
 */
export type OverlayKind =
    | 'marker'
    | 'circle'
    | 'groundImage'
    | 'polyline'
    | 'polygon'
    | 'rasterLayer';

/** 列挙するための一覧。android の `entries` / iOS の `allCases` に対応する。 */
export const OVERLAY_KINDS: readonly OverlayKind[] = [
    'marker',
    'circle',
    'groundImage',
    'polyline',
    'polygon',
    'rasterLayer',
] as const;
