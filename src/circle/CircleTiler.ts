import { createRasterLayerState, type RasterLayerState } from '../raster/RasterLayerState';
import { RasterLayerSource } from '../raster/RasterLayerSource';
import type { SWCircle } from '../tileserver/LocalTileServer';
import { CIRCLE_TILE_CODEC, ShapeTiler, ShapeTileSet } from '../tileserver/ShapeTileSet';
import type { CircleState } from './CircleState';
import { CircleTileSet } from './CircleTileSet';
import { CircleTilingOptions } from './CircleTilingOptions';

/** The id of the raster layer that shows tiled circles. */
export const CIRCLE_TILE_LAYER_ID = 'mc-circle-tiles';

/** The raster layer state for tiled circles at `template`. */
export function circleTileRasterLayerState(template: string, tileSize = 256): RasterLayerState {
    return createRasterLayerState({
        id: CIRCLE_TILE_LAYER_ID,
        source: RasterLayerSource.UrlTemplate({ template, tileSize }),
    });
}

/**
 * Decides which of a map's circles are drawn as tiles, keeps them registered
 * with the tile service worker, and tells the provider where the tiles are.
 * The counterpart of {@link PolygonTiler} and {@link PolylineTiler}, used the same way:
 * 1. {@link route} with the full list on every composition. It returns the ids
 *    now in tiles; the controller keeps those in its `CircleManager` (taps are
 *    resolved there, against the original circles) but gives the map SDK nothing
 *    for them, and removes any native circle it had drawn for one.
 * 2. {@link update} for an in-place change of a tiled circle, or {@link remove}
 *    when the change means it can no longer be tiled.
 * 3. {@link onTemplate} is how the tiles reach the map: a URL template to show
 *    as a raster layer, or null to remove it. A provider with a RasterLayer
 *    controller hands {@link circleTileRasterLayerState} to its `upsert`.
 *    The layer belongs to the circle band, at its bottom: over the polygons
 *    (tiled or not), under the natively drawn circles, the polylines (tiled or
 *    not) and the markers.
 *
 * The tiles draw in the order the map SDKs do: zIndex, a null one being the
 * automatic zIndex of the circle renderers (further south on top), then the
 * order given.
 */
export class CircleTiler {
    onTemplate: ((template: string | null, tileSize: number) => void | Promise<void>) | null = null;

    private readonly shapes: ShapeTiler<CircleState, SWCircle>;

    /**
     * @param options When to tile. It may be replaced later: the next {@link route}
     *   decides again with the new value (the circles already routed stay as
     *   they are until then).
     */
    constructor(public options: CircleTilingOptions = CircleTilingOptions.Default) {
        this.shapes = new ShapeTiler<CircleState, SWCircle>(
            new ShapeTileSet(CIRCLE_TILE_CODEC),
            (state) => CircleTileSet.canTile(state),
            (tileable) => CircleTilingOptions.shouldUseTiles(this.options, tileable.length),
        );
        this.shapes.onTemplate = (template, tileSize) => this.onTemplate?.(template, tileSize);
    }

    /** Re-decides tiling for `data` and resolves to the ids drawn as tiles. */
    route(data: readonly CircleState[]): Promise<ReadonlySet<string>> {
        return this.shapes.route(data);
    }

    /** The states drawn as tiles, as of the last {@link route}. */
    tiledStates(): readonly CircleState[] {
        return this.shapes.tiledStates();
    }

    isTiled(id: string): boolean {
        return this.shapes.isTiled(id);
    }

    state(id: string): CircleState | null { return this.shapes.state(id); }
    visitStates(action: (state: CircleState) => void): void { this.shapes.visitStates(action); }

    /** An in-place change of a tiled circle; only the tiles it touches are redrawn. */
    update(state: CircleState): void {
        this.shapes.update(state);
    }

    /**
     * Takes one circle out of the tiles, for a change that left it no longer
     * {@link CircleTileSet.canTile}; only the tiles it was in are redrawn. The
     * controller then hands it to the map SDK.
     */
    remove(id: string): void {
        this.shapes.remove(id);
    }

    clear(): Promise<void> {
        return this.shapes.clear();
    }
}
