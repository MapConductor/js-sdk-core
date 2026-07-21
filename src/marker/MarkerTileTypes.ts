export const MARKER_HIT_RADIUS_TOUCH_PX = 20;
export const MARKER_HIT_RADIUS_MOUSE_PX = 6;

export interface MarkerTileRenderingOptions<T = never> {
    tileSize?: number;
    /** Return an icon scale factor for a given item and zoom level. Defaults to a built-in zoom curve. */
    iconScaleCallback?: (item: T, zoom: number) => number;
    /**
     * Extra multiplier applied on top of iconScaleCallback, independent of
     * MarkerIcon.scale (which is already baked into BitmapIcon.size by
     * toBitmapIcon()). Mirrors Android/iOS MarkerTileRenderer.extraIconScale;
     * only non-1 SDKs need to override the default.
     */
    extraIconScale?: number;
}

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
