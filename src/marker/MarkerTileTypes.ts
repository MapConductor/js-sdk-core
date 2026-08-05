export const MARKER_HIT_RADIUS_TOUCH_PX = 20;
export const MARKER_HIT_RADIUS_MOUSE_PX = 6;

/** A marker resolved to its decoded image and tile-local draw geometry, ready for drawImage(). */
export interface PreparedMarker {
    image: ImageBitmap | HTMLImageElement;
    centerNormX: number;
    centerNormY: number;
    drawW: number;
    drawH: number;
    anchorX: number;
    anchorY: number;
}
