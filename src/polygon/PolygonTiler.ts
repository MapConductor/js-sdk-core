import { createRasterLayerState, type RasterLayerState } from '../raster/RasterLayerState';
import { RasterLayerSource } from '../raster/RasterLayerSource';
import type { PolygonState } from './PolygonState';
import { PolygonTileSet } from './PolygonTileSet';
import { PolygonTilingOptions } from './PolygonTilingOptions';

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
 * 2. {@link update} for an in-place change of a tiled polygon.
 * 3. {@link onTemplate} is how the tiles reach the map: a URL template to show
 *    as a raster layer, or null to remove it. A provider with a RasterLayer
 *    controller hands {@link polygonTileRasterLayerState} to its `upsert`.
 */
export class PolygonTiler {
    onTemplate: ((template: string | null, tileSize: number) => void | Promise<void>) | null = null;

    private readonly tileSet = new PolygonTileSet();
    private tiled = new Set<string>();
    private states: readonly PolygonState[] = [];

    constructor(readonly options: PolygonTilingOptions = PolygonTilingOptions.Default) {
        this.tileSet.onTemplateChanged = (template) => void this.onTemplate?.(template, this.tileSet.tileSize);
    }

    /** Re-decides tiling for `data` and resolves to the ids drawn as tiles. */
    async route(data: readonly PolygonState[]): Promise<ReadonlySet<string>> {
        const tileable = data.filter((state) => PolygonTileSet.canTile(state));
        const useTiles = PolygonTilingOptions.shouldUseTiles(
            this.options,
            tileable.length,
            PolygonTileSet.vertexCount(tileable),
        );
        // Null without a service worker that can draw them: draw natively then.
        const template = useTiles ? await this.tileSet.setPolygons(tileable) : null;
        if (template == null) {
            this.tileSet.dispose();
            this.tiled = new Set();
            this.states = [];
        } else {
            this.tiled = new Set(tileable.map((state) => state.id));
            this.states = tileable;
        }
        await this.onTemplate?.(template, this.tileSet.tileSize);
        return this.tiled;
    }

    /** The states drawn as tiles, as of the last {@link route}. */
    tiledStates(): readonly PolygonState[] {
        return this.states;
    }

    isTiled(id: string): boolean {
        return this.tiled.has(id);
    }

    /** An in-place change of a tiled polygon; only the tiles it touches are redrawn. */
    update(state: PolygonState): void {
        this.tileSet.update(state);
    }

    async clear(): Promise<void> {
        this.tileSet.dispose();
        this.tiled = new Set();
        this.states = [];
        await this.onTemplate?.(null, this.tileSet.tileSize);
    }
}
