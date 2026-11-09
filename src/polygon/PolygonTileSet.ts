import { longitudeSpan, POLYGON_TILE_CODEC, ShapeTileSet } from '../tileserver/ShapeTileSet';
import type { PolygonState } from './PolygonState';

/**
 * The polygons of one map that are drawn as raster tiles, and their route on
 * the tile service worker.
 *
 * Provider-independent: a provider decides which polygons to tile
 * ({@link PolygonTilingOptions.shouldUseTiles}, {@link PolygonTileSet.canTile}),
 * hands them to {@link setPolygons}, and shows the returned URL template as a
 * raster layer. In-place changes go through {@link update}; each one ends in a
 * new template (the version in it is what makes the map ask again), reported
 * to {@link onTemplateChanged}. Tiles the change did not touch are still cached
 * by the worker and come back without being redrawn.
 *
 * Needs a service worker that can draw with OffscreenCanvas; {@link setPolygons}
 * resolves to null without one, and the provider should draw the polygons
 * itself instead.
 */
export class PolygonTileSet {
    readonly routeId: string;
    onTemplateChanged: ((template: string) => void) | null = null;

    private readonly shapes = new ShapeTileSet(POLYGON_TILE_CODEC);

    constructor() {
        this.routeId = this.shapes.routeId;
        this.shapes.onTemplateChanged = (template) => this.onTemplateChanged?.(template);
    }

    /**
     * Whether a polygon can be drawn in a tile. Geodesic edges are curves the
     * tile does not trace, and a ring spanning half the world or more crosses
     * the antimeridian; the map SDK draws both.
     */
    static canTile(state: PolygonState): boolean {
        return !state.geodesic && state.points.length >= 3 && longitudeSpan(state.points) < 180;
    }

    static vertexCount(states: readonly PolygonState[]): number {
        let n = 0;
        for (const s of states) {
            n += s.points.length;
            for (const h of s.holes) n += h.length;
        }
        return n;
    }

    /**
     * Registers `states` (replacing whatever was registered) and resolves to
     * the URL template of their tiles, or null when no service worker can
     * draw them.
     */
    setPolygons(states: readonly PolygonState[]): Promise<string | null> {
        return this.shapes.setShapes(states);
    }

    has(id: string): boolean {
        return this.shapes.has(id);
    }

    /**
     * One polygon changed in place. A change of zIndex reorders the list and
     * needs {@link setPolygons} instead; everything else is applied here.
     */
    update(state: PolygonState): void {
        this.shapes.update(state);
    }

    /**
     * Takes one polygon out of the tiles. Its slot in the worker's list is
     * left empty, so the others keep their indices and only the tiles it was
     * in are drawn again.
     */
    remove(id: string): void {
        this.shapes.remove(id);
    }

    template(): string {
        return this.shapes.template();
    }

    get tileSize(): number {
        return this.shapes.tileSize;
    }

    dispose(): void {
        this.shapes.dispose();
    }
}
