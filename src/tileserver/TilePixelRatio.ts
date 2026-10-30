/**
 * Device pixels per CSS pixel for raster tiles drawn on this page.
 *
 * A tile is laid out as `tileSize` CSS pixels whatever its image size, so a 1x
 * tile on a 2x display is stretched to twice its size and its icons and labels
 * blur. Drawing it at the display's ratio puts one image pixel on each screen
 * pixel.
 *
 * Capped at {@link MAX_TILE_PIXEL_RATIO}: phones commonly report 3, and a 3x
 * tile is nine times the pixels (and the memory, and the drawing time) of a 1x
 * one for a difference that is hard to see at icon size. Fractional ratios
 * round up, so a 1.5x display gets 2x tiles rather than blurred 1x ones.
 */
export const MAX_TILE_PIXEL_RATIO = 2;

export function tilePixelRatio(
    devicePixelRatio: number | undefined = typeof globalThis.devicePixelRatio === 'number'
        ? globalThis.devicePixelRatio
        : undefined,
): number {
    if (devicePixelRatio === undefined || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 1) return 1;
    return Math.min(Math.ceil(devicePixelRatio), MAX_TILE_PIXEL_RATIO);
}

/**
 * The `@{n}x` before `.png` in a tile URL: empty at 1x, so 1x URLs are the
 * same as they were before tiles had a ratio.
 */
export function tilePixelRatioSuffix(pixelRatio: number | undefined): string {
    return pixelRatio !== undefined && pixelRatio > 1 ? `@${pixelRatio}x` : '';
}

/**
 * The ratio a tile URL's `@{n}x` asked for, or 1 without one. Kept to whole
 * numbers from 1 to 3, as the Service Worker does, so a bad URL cannot ask for
 * an enormous canvas.
 */
export function parseTilePixelRatio(suffix: string | undefined): number {
    const match = suffix?.match(/^@(\d+)x$/);
    if (!match) return 1;
    return Math.min(Math.max(Number(match[1]), 1), 3);
}
