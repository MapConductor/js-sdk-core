/**
 * Options for polygon tiling.
 *
 * When enabled and a map holds enough polygons, they are drawn into raster
 * tiles by the tile service worker instead of being handed to the map SDK one
 * by one. Taps are still resolved against the original shapes in
 * `PolygonManager`, so tiling changes how polygons look, never what a tap hits.
 *
 * The counterpart of {@link MarkerTilingOptions}.
 */
export interface PolygonTilingOptions {
    readonly enabled: boolean;
    /** Tile once a map holds at least this many polygons… */
    readonly minPolygonCount: number;
    /** …or at least this many vertices across them, whichever comes first. */
    readonly minVertexCount: number;
}

export namespace PolygonTilingOptions {
    export const Default: PolygonTilingOptions = {
        enabled: true,
        minPolygonCount: 2000,
        minVertexCount: 50_000,
    };

    export const Disabled: PolygonTilingOptions = {
        ...Default,
        enabled: false,
    };

    /** The one place the threshold is decided; callers must not restate it. */
    export function shouldUseTiles(options: PolygonTilingOptions, polygonCount: number, vertexCount: number): boolean {
        return options.enabled && (polygonCount >= options.minPolygonCount || vertexCount >= options.minVertexCount);
    }
}
