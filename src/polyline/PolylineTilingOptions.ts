/**
 * Options for polyline tiling.
 *
 * When enabled and a map holds enough polylines, they are drawn into raster
 * tiles by the tile service worker instead of being handed to the map SDK one
 * by one. Taps are still resolved against the original paths in
 * `PolylineManager`, so tiling changes how polylines look, never what a tap hits.
 *
 * The counterpart of {@link PolygonTilingOptions}, with the same thresholds.
 */
export interface PolylineTilingOptions {
    readonly enabled: boolean;
    /** Tile once a map holds at least this many polylines… */
    readonly minPolylineCount: number;
    /** …or at least this many vertices across them, whichever comes first. */
    readonly minVertexCount: number;
}

export namespace PolylineTilingOptions {
    export const Default: PolylineTilingOptions = {
        enabled: true,
        minPolylineCount: 2000,
        minVertexCount: 50_000,
    };

    export const Disabled: PolylineTilingOptions = {
        ...Default,
        enabled: false,
    };

    /** The one place the threshold is decided; callers must not restate it. */
    export function shouldUseTiles(options: PolylineTilingOptions, polylineCount: number, vertexCount: number): boolean {
        return options.enabled && (polylineCount >= options.minPolylineCount || vertexCount >= options.minVertexCount);
    }
}
