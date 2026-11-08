import type { OverlayKind } from '../controller/OverlayKind';

/**
 * オーバーレイの重なり順（下から上）。すべてのプロバイダ・3 プラットフォームで同じ。
 *
 * 1. ラスターレイヤー（アプリが足すタイル）
 * 2. GroundImage
 * 3. ポリゴン（ネイティブのポリゴンと、SDK のポリゴンのタイルレイヤーは同じ帯）
 * 4. サークル
 * 5. ポリライン
 * 6. マーカー（ネイティブのマーカーと、SDK のマーカーのタイルレイヤーは同じ帯）
 *
 * 追加した順・送り直した順（`clearOverlays()` の後など）・デザイン変更に左右されない。
 * 帯の中は zIndex、同じ zIndex なら渡された順（後のものが上）。
 *
 * android-sdk / ios-sdk にも同じ並びで置く。クリックの探索順（{@link CANONICAL_ORDER}）とは別軸。
 *
 * @internal ドライバー実装点。
 */
export const OVERLAY_STACK_ORDER: readonly OverlayKind[] = [
    'rasterLayer',
    'groundImage',
    'polygon',
    'circle',
    'polyline',
    'marker',
] as const;

/**
 * 帯の番号。0 が一番下（ラスター）、5 が一番上（マーカー）。
 *
 * @internal ドライバー実装点。
 */
export function overlayStackBand(kind: OverlayKind): number {
    return OVERLAY_STACK_ORDER.indexOf(kind);
}

/**
 * 1 つの描画物（GL のレイヤー、ペインなど）の重なり順を決める鍵。
 *
 * - `kind`: どの帯か。
 * - `zIndex`: 帯の中の順。
 * - `sequence`: 同じ zIndex の中の順。渡された順の番号（大きいほど上）。
 *   1 つの描画物が複数の SDK レイヤーを持つ（塗りと輪郭など）ときは `sub` で並べる。
 *
 * @internal ドライバー実装点。
 */
export interface OverlayStackKey {
    readonly kind: OverlayKind;
    readonly zIndex?: number;
    readonly sequence?: number;
    readonly sub?: number;
}

/**
 * 重なり順の比較。負なら `a` が下。
 *
 * @internal ドライバー実装点。
 */
export function compareOverlayStackKeys(a: OverlayStackKey, b: OverlayStackKey): number {
    return (
        overlayStackBand(a.kind) - overlayStackBand(b.kind) ||
        (a.zIndex ?? 0) - (b.zIndex ?? 0) ||
        (a.sequence ?? 0) - (b.sequence ?? 0) ||
        (a.sub ?? 0) - (b.sub ?? 0)
    );
}

/**
 * レイヤーを順に積む SDK（MapLibre GL 系の `addLayer(layer, beforeId)` など）で、
 * 新しいレイヤーを `target` の位置に入れるための `beforeId`。
 *
 * `order` は今の地図のレイヤー id（下から上）。`keyOf` は自分たちのレイヤーなら鍵を、
 * それ以外（ベースマップ、拡張が足したもの）なら null を返す。
 * 自分たちのレイヤーのうち `target` より上に来るべき最初のものの id を返す。無ければ
 * undefined（一番上に積む）。
 *
 * **追加した順に依存しない**: 毎回この関数で入れれば、どの順で足しても、スタイルの差し替え後に
 * どの順で戻しても、同じ並びになる。
 *
 * @internal ドライバー実装点。
 */
export function overlayStackBeforeId(
    order: readonly string[],
    keyOf: (layerId: string) => OverlayStackKey | null | undefined,
    target: OverlayStackKey,
): string | undefined {
    for (const id of order) {
        const key = keyOf(id);
        if (key == null) continue;
        if (compareOverlayStackKeys(key, target) > 0) return id;
    }
    return undefined;
}

/**
 * 数値で重なりを決める SDK（ペインの CSS z-index、deck.gl のレイヤー順、Cesium の地表 zIndex、
 * OpenLayers のレイヤー zIndex など）向けの値。
 *
 * `base + 帯 * bandSize + zIndex` を返す。zIndex は帯からはみ出さないよう
 * `±(bandSize / 2 - 1)` に丸める（帯をまたいで逆転させないため）。
 *
 * @internal ドライバー実装点。
 */
export function overlayStackZ(
    kind: OverlayKind,
    zIndex: number | null | undefined = 0,
    { base = 0, bandSize = 1000 }: { base?: number; bandSize?: number } = {},
): number {
    const limit = Math.floor(bandSize / 2) - 1;
    const z = Math.max(-limit, Math.min(limit, Math.round(zIndex ?? 0)));
    return base + overlayStackBand(kind) * bandSize + z;
}
