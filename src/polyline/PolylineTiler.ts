import { createRasterLayerState, type RasterLayerState } from '../raster/RasterLayerState';
import { RasterLayerSource } from '../raster/RasterLayerSource';
import type { SWPolyline } from '../tileserver/LocalTileServer';
import { POLYLINE_TILE_CODEC, ShapeTiler, ShapeTileSet } from '../tileserver/ShapeTileSet';
import type { PolylineState } from './PolylineState';
import { PolylineTileSet } from './PolylineTileSet';
import { PolylineTilingOptions } from './PolylineTilingOptions';

/** The id of the raster layer that shows tiled polylines. */
export const POLYLINE_TILE_LAYER_ID = 'mc-polyline-tiles';

/** The raster layer state for tiled polylines at `template`. */
export function polylineTileRasterLayerState(template: string, tileSize = 256): RasterLayerState {
    return createRasterLayerState({
        id: POLYLINE_TILE_LAYER_ID,
        source: RasterLayerSource.UrlTemplate({ template, tileSize }),
    });
}

/**
 * Decides which of a map's polylines are drawn as tiles, keeps them registered
 * with the tile service worker, and tells the provider where the tiles are.
 * The counterpart of {@link PolygonTiler}, used the same way:
 * 1. {@link route} with the full list on every composition. It returns the ids
 *    now in tiles; the controller keeps those in its `PolylineManager` (taps are
 *    resolved there, against the original paths) but gives the map SDK nothing
 *    for them, and removes any native polyline it had drawn for one.
 * 2. {@link update} for an in-place change of a tiled polyline, or {@link remove}
 *    when the change means it can no longer be tiled.
 * 3. {@link onTemplate} is how the tiles reach the map: a URL template to show
 *    as a raster layer, or null to remove it. A provider with a RasterLayer
 *    controller hands {@link polylineTileRasterLayerState} to its `upsert`.
 *    The layer belongs to the polyline band: over the circles, under the
 *    natively drawn polylines and the markers.
 */
export class PolylineTiler {
    onTemplate: ((template: string | null, tileSize: number) => void | Promise<void>) | null = null;

    private readonly shapes: ShapeTiler<PolylineState, SWPolyline>;

    /**
     * @param options When to tile. It may be replaced later: the next {@link route}
     *   decides again with the new value (the polylines already routed stay as
     *   they are until then).
     */
    constructor(public options: PolylineTilingOptions = PolylineTilingOptions.Default) {
        this.shapes = new ShapeTiler<PolylineState, SWPolyline>(
            new ShapeTileSet(POLYLINE_TILE_CODEC),
            (state) => PolylineTileSet.canTile(state),
            (tileable) =>
                PolylineTilingOptions.shouldUseTiles(this.options, tileable.length, PolylineTileSet.vertexCount(tileable)),
        );
        this.shapes.onTemplate = (template, tileSize) => this.onTemplate?.(template, tileSize);
    }

    /** Re-decides tiling for `data` and resolves to the ids drawn as tiles. */
    route(data: readonly PolylineState[]): Promise<ReadonlySet<string>> {
        return this.shapes.route(data);
    }

    /** The states drawn as tiles, as of the last {@link route}. */
    tiledStates(): readonly PolylineState[] {
        return this.shapes.tiledStates();
    }

    isTiled(id: string): boolean {
        return this.shapes.isTiled(id);
    }

    /** An in-place change of a tiled polyline; only the tiles it touches are redrawn. */
    update(state: PolylineState): void {
        this.shapes.update(state);
    }

    /**
     * Takes one polyline out of the tiles, for a change that left it no longer
     * {@link PolylineTileSet.canTile}; only the tiles it was in are redrawn. The
     * controller then hands it to the map SDK.
     */
    remove(id: string): void {
        this.shapes.remove(id);
    }

    clear(): Promise<void> {
        return this.shapes.clear();
    }
}
