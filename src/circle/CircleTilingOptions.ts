/**
 * Options for circle tiling.
 *
 * When enabled and a map holds enough circles, they are drawn into raster
 * tiles by the tile service worker instead of being handed to the map SDK one
 * by one. Taps are still resolved against the original circles in
 * `CircleManager`, so tiling changes how circles look, never what a tap hits.
 *
 * The counterpart of {@link PolygonTilingOptions} and {@link PolylineTilingOptions},
 * with the same count. A circle has no vertices of its own, so there is no
 * vertex threshold.
 */
export interface CircleTilingOptions {
    readonly enabled: boolean;
    /** Tile once a map holds at least this many circles. */
    readonly minCircleCount: number;
}

export namespace CircleTilingOptions {
    export const Default: CircleTilingOptions = {
        enabled: true,
        minCircleCount: 2001,
    };

    export const Disabled: CircleTilingOptions = {
        ...Default,
        enabled: false,
    };

    /** The one place the threshold is decided; callers must not restate it. */
    export function shouldUseTiles(options: CircleTilingOptions, circleCount: number): boolean {
        return options.enabled && circleCount >= options.minCircleCount;
    }
}
