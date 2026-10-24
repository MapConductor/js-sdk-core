import { AbstractDefaultIcon } from "./AbstractDefaultIcon";
import type { MarkerIcon } from "./MarkerIcon";

/**
 * アイコンが画面上で占める幅と高さ（CSS px）。`anchor` / `infoAnchor` はこの矩形に対する割合。
 *
 * 既定アイコンはラベルの分だけビットマップがピン本体（iconSize × scale の正方形）より広い
 * ことがあるので、その倍率を掛ける。それ以外のアイコンは従来どおり正方形として扱う。
 * アイコンが無ければ 0（吹き出しの尾がマーカー位置そのものを指す）。
 *
 * android-sdk の `MarkerIconExtent`、ios-sdk の `MarkerIconMetrics` に対応する。
 *
 * @internal ドライバー実装点。公開 API サーフェスには含めない。
 */
export function markerIconExtentPx(icon: MarkerIcon | null | undefined): { width: number; height: number } {
    if (!icon) return { width: 0, height: 0 };
    const size = icon.iconSize * icon.scale;
    if (icon instanceof AbstractDefaultIcon) {
        const ratio = icon.extentRatio;
        return { width: size * ratio.width, height: size * ratio.height };
    }
    return { width: size, height: size };
}
