import { AbstractDefaultIcon } from "./AbstractDefaultIcon";
import { ImageIcon } from "./ImageIcon";
import type { MarkerIcon } from "./MarkerIcon";
import type { BitmapIcon } from "./MarkerOverlayRenderer";
import type { Offset } from "../types";

/**
 * アイコンが画面上で占める幅と高さ（CSS px）。`anchor` / `infoAnchor` はこの矩形に対する割合。
 *
 * 既定アイコンと画像アイコンはラベルの分だけビットマップが本体（iconSize × scale の正方形）
 * より広いことがあるので、その倍率を掛ける。それ以外のアイコンは従来どおり正方形として扱う。
 * アイコンが無ければ 0（吹き出しの尾がマーカー位置そのものを指す）。
 *
 * android-sdk の `MarkerIconExtent`、ios-sdk の `MarkerIconMetrics` に対応する。
 *
 * @internal ドライバー実装点。公開 API サーフェスには含めない。
 */
export function markerIconExtentPx(icon: MarkerIcon | null | undefined): { width: number; height: number } {
    if (!icon) return { width: 0, height: 0 };
    const size = icon.iconSize * icon.scale;
    if (icon instanceof AbstractDefaultIcon || icon instanceof ImageIcon) {
        const ratio = icon.extentRatio;
        return { width: size * ratio.width, height: size * ratio.height };
    }
    return { width: size, height: size };
}

/**
 * The part of a drawn icon a tap should hit: its width and height on screen
 * (CSS px) and where the anchor sits in it, as a fraction — the shape
 * {@link pickMarkerHit} takes, less the anchor's screen position.
 *
 * The bitmap's {@link BitmapIcon.hitBounds} when it has them (a default pin:
 * the pin and its label, not the square around it), the whole bitmap
 * otherwise. `drawWidth` / `drawHeight` are the size the bitmap is drawn at
 * when that is not its own (tiled markers scale it).
 *
 * @internal ドライバー実装点。公開 API サーフェスには含めない。
 */
export function markerHitShape(
    bitmap: BitmapIcon,
    drawWidth: number = bitmap.size.width,
    drawHeight: number = bitmap.size.height,
): { width: number; height: number; anchor: Offset } {
    const b = bitmap.hitBounds ?? { left: 0, top: 0, right: 1, bottom: 1 };
    const w = Math.max(b.right - b.left, 1e-6);
    const h = Math.max(b.bottom - b.top, 1e-6);
    return {
        width: w * drawWidth,
        height: h * drawHeight,
        anchor: { x: (bitmap.anchor.x - b.left) / w, y: (bitmap.anchor.y - b.top) / h },
    };
}
