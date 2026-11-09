import { longitudeSpan, POLYLINE_TILE_CODEC, ShapeTileSet } from '../tileserver/ShapeTileSet';
import type { PolylineState } from './PolylineState';

/**
 * The polylines of one map that are drawn as raster tiles, and their route on
 * the tile service worker. The counterpart of {@link PolygonTileSet}.
 *
 * A tile draws each polyline as one open path, `strokeWidth` CSS pixels wide
 * whatever the zoom, with round caps and joins, and draws the part of a line
 * that overhangs the tile too, so a line crossing a tile edge continues in the
 * next tile at the same place and width. A line shorter than a pixel at a zoom
 * is drawn as a dot as wide as the line.
 *
 * In-place changes go through {@link update}; each one ends in a new template
 * (with a new version in it), reported to {@link onTemplateChanged}.
 *
 * Needs a service worker that can draw with OffscreenCanvas; {@link setPolylines}
 * resolves to null without one, and the provider should draw the polylines
 * itself instead.
 */
export class PolylineTileSet {
    readonly routeId: string;
    onTemplateChanged: ((template: string) => void) | null = null;

    private readonly shapes = new ShapeTileSet(POLYLINE_TILE_CODEC);

    constructor() {
        this.routeId = this.shapes.routeId;
        this.shapes.onTemplateChanged = (template) => this.onTemplateChanged?.(template);
    }

    /**
     * Whether a polyline can be drawn in a tile. Geodesic segments are curves
     * the tile does not trace, a line spanning half the world or more crosses
     * the antimeridian, and a single point is not a line; the map SDK draws
     * all of them.
     */
    static canTile(state: PolylineState): boolean {
        return !state.geodesic && state.points.length >= 2 && longitudeSpan(state.points) < 180;
    }

    static vertexCount(states: readonly PolylineState[]): number {
        let n = 0;
        for (const s of states) n += s.points.length;
        return n;
    }

    /**
     * Registers `states` (replacing whatever was registered) and resolves to
     * the URL template of their tiles, or null when no service worker can
     * draw them.
     */
    setPolylines(states: readonly PolylineState[]): Promise<string | null> {
        return this.shapes.setShapes(states);
    }

    has(id: string): boolean {
        return this.shapes.has(id);
    }

    /**
     * One polyline changed in place. A change of zIndex reorders the list and
     * needs {@link setPolylines} instead; everything else is applied here.
     */
    update(state: PolylineState): void {
        this.shapes.update(state);
    }

    /**
     * Takes one polyline out of the tiles. Its slot in the worker's list is
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
