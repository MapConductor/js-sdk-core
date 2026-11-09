import { createRasterLayerState, type RasterLayerState } from '../raster/RasterLayerState';
import { RasterLayerSource } from '../raster/RasterLayerSource';
import type { PolygonState } from './PolygonState';
import { PolygonTileSet } from './PolygonTileSet';
import { PolygonTilingOptions } from './PolygonTilingOptions';
import { POLYGON_TILE_CODEC, ShapeTiler, ShapeTileSet } from '../tileserver/ShapeTileSet';
import type { SWPolygon } from '../tileserver/LocalTileServer';

/** The id of the raster layer that shows tiled polygons. */
export const POLYGON_TILE_LAYER_ID = 'mc-polygon-tiles';

/** The raster layer state for tiled polygons at `template`. */
export function polygonTileRasterLayerState(template: string, tileSize = 256): RasterLayerState {
    return createRasterLayerState({
        id: POLYGON_TILE_LAYER_ID,
        source: RasterLayerSource.UrlTemplate({ template, tileSize }),
    });
}

/**
 * Decides which of a map's polygons are drawn as tiles, keeps them registered
 * with the tile service worker, and tells the provider where the tiles are.
 *
 * Every provider's polygon controller uses it the same way:
 * 1. {@link route} with the full list on every composition. It returns the ids
 *    now in tiles; the controller keeps those in its `PolygonManager` (taps are
 *    resolved there, against the original shapes) but gives the map SDK nothing
 *    for them, and removes any native polygon it had drawn for one.
 * 2. {@link update} for an in-place change of a tiled polygon, or {@link remove}
 *    when the change means it can no longer be tiled.
 * 3. {@link onTemplate} is how the tiles reach the map: a URL template to show
 *    as a raster layer, or null to remove it. A provider with a RasterLayer
 *    controller hands {@link polygonTileRasterLayerState} to its `upsert`.
 */
export class PolygonTiler {
    onTemplate: ((template: string | null, tileSize: number) => void | Promise<void>) | null = null;

    private readonly shapes: ShapeTiler<PolygonState, SWPolygon>;

    constructor(readonly options: PolygonTilingOptions = PolygonTilingOptions.Default) {
        this.shapes = new ShapeTiler<PolygonState, SWPolygon>(
            new ShapeTileSet(POLYGON_TILE_CODEC),
            (state) => PolygonTileSet.canTile(state),
            (tileable) =>
                PolygonTilingOptions.shouldUseTiles(this.options, tileable.length, PolygonTileSet.vertexCount(tileable)),
        );
        this.shapes.onTemplate = (template, tileSize) => this.onTemplate?.(template, tileSize);
    }

    /** Re-decides tiling for `data` and resolves to the ids drawn as tiles. */
    route(data: readonly PolygonState[]): Promise<ReadonlySet<string>> {
        return this.shapes.route(data);
    }

    /** The states drawn as tiles, as of the last {@link route}. */
    tiledStates(): readonly PolygonState[] {
        return this.shapes.tiledStates();
    }

    isTiled(id: string): boolean {
        return this.shapes.isTiled(id);
    }

    /** An in-place change of a tiled polygon; only the tiles it touches are redrawn. */
    update(state: PolygonState): void {
        this.shapes.update(state);
    }

    /**
     * Takes one polygon out of the tiles, for a change that left it no longer
     * {@link PolygonTileSet.canTile}; only the tiles it was in are redrawn. The
     * controller then hands it to the map SDK.
     */
    remove(id: string): void {
        this.shapes.remove(id);
    }

    clear(): Promise<void> {
        return this.shapes.clear();
    }
}
