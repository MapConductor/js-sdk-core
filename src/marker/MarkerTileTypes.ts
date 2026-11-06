export const MARKER_HIT_RADIUS_TOUCH_PX = 20;
/**
 * A mouse points at a pixel, so only what is drawn under it counts. A finger
 * covers an area and keeps the touch radius.
 */
export const MARKER_HIT_RADIUS_MOUSE_PX = 0;

/** A marker resolved to its decoded image and tile-local draw geometry, ready for drawImage(). */
export interface PreparedMarker {
    image: ImageBitmap | HTMLImageElement;
    centerNormX: number;
    centerNormY: number;
    drawW: number;
    drawH: number;
    anchorX: number;
    anchorY: number;
    /** 本体を描き終えたあとに重ねるラベル（`MarkerTileLabel`）。寸法は描画倍率を掛けたもの。 */
    label?: PreparedLabel | null;
}

/** タイル上のラベル。中心はアンカー点からのずれで持つ。 */
export interface PreparedLabel {
    image: ImageBitmap | HTMLImageElement;
    centerOffsetX: number;
    centerOffsetY: number;
    drawW: number;
    drawH: number;
}
