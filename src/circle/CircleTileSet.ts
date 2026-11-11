import { CIRCLE_TILE_CODEC, ShapeTileSet } from '../tileserver/ShapeTileSet';
import { Earth } from '../projection/Earth';
import { normalizeLngDegrees } from '../geometry/CircleGeometry';
import type { CircleState } from './CircleState';

/** The latitude Web Mercator stops at; a circle reaching it is drawn by the map SDK. */
const MERCATOR_MAX_LATITUDE = 85.05112878;
const DEG = Math.PI / 180;

/**
 * The latitudes and longitudes a circle spans, in degrees, as the ring the map
 * SDKs draw (`circleToRing`) spans them, whatever the zoom. The longitudes are
 * round the centre's in [-180, 180] and may run past ±180. Null when the circle
 * goes over a pole (a geodesic one whose radius reaches it).
 * @internal
 */
export function circleTileExtent(state: CircleState): { north: number; south: number; west: number; east: number } | null {
    const { latitude } = state.center;
    const longitude = normalizeLngDegrees(state.center.longitude);
    const r = state.radiusMeters;
    let dLat: number;
    let dLng: number;
    if (state.geodesic) {
        // The circle on the sphere of Spherical.computeOffset.
        const delta = r / Earth.RADIUS_METERS;
        const cosLat = Math.cos(latitude * DEG);
        if (!(Math.sin(delta) < cosLat) || delta >= Math.PI / 2) return null;
        dLat = delta / DEG;
        dLng = Math.asin(Math.min(1, Math.sin(delta) / cosLat)) / DEG;
    } else {
        // circleToRing's local plane round the centre latitude.
        const metersPerDegree = Earth.CIRCUMFERENCE_METERS / 360;
        dLat = r / metersPerDegree;
        dLng = r / (metersPerDegree * Math.max(Math.cos(latitude * DEG), 1e-6));
    }
    return { north: latitude + dLat, south: latitude - dLat, west: longitude - dLng, east: longitude + dLng };
}

/**
 * The circles of one map that are drawn as raster tiles, and their route on
 * the tile service worker. The counterpart of {@link PolygonTileSet} and
 * {@link PolylineTileSet}.
 *
 * A tile draws each circle as the map SDKs do: the ring `radiusMeters` from the
 * centre (`circleToRing`, on the sphere when `geodesic`), so its size on screen
 * doubles with each zoom level, filled, and outlined `strokeWidth` CSS pixels
 * wide at every zoom with the line centred on the ring. Where the ring is
 * round on screen to a quarter of a pixel it is drawn as an arc, else as the
 * ring's points; a circle under a pixel across is one pixel, and one under
 * 4 px across has no outline (as the polygons). The part of a circle that
 * overhangs a tile is drawn too, so it goes on in the next tile unbroken.
 *
 * In-place changes go through {@link update}; each one ends in a new template
 * (with a new version in it), reported to {@link onTemplateChanged}.
 *
 * Needs a service worker that can draw with OffscreenCanvas; {@link setCircles}
 * resolves to null without one, and the provider should draw the circles
 * itself instead.
 */
export class CircleTileSet {
    readonly routeId: string;
    onTemplateChanged: ((template: string) => void) | null = null;

    private readonly shapes = new ShapeTileSet(CIRCLE_TILE_CODEC);

    constructor() {
        this.routeId = this.shapes.routeId;
        this.shapes.onTemplateChanged = (template) => this.onTemplateChanged?.(template);
    }

    /**
     * Whether a circle can be drawn in a tile. A radius that is not a positive
     * number draws nothing; a circle reaching a pole or past Web Mercator's
     * latitudes, or crossing the antimeridian, is left to the map SDK.
     */
    static canTile(state: CircleState): boolean {
        const r = state.radiusMeters;
        if (!(r > 0) || !Number.isFinite(r)) return false;
        if (!Number.isFinite(state.center.latitude) || !Number.isFinite(state.center.longitude)) return false;
        const extent = circleTileExtent(state);
        if (!extent) return false;
        return (
            extent.north < MERCATOR_MAX_LATITUDE &&
            extent.south > -MERCATOR_MAX_LATITUDE &&
            extent.west > -180 &&
            extent.east < 180
        );
    }

    /**
     * Registers `states` (replacing whatever was registered) and resolves to
     * the URL template of their tiles, or null when no service worker can
     * draw them.
     */
    setCircles(states: readonly CircleState[]): Promise<string | null> {
        return this.shapes.setShapes(states);
    }

    has(id: string): boolean {
        return this.shapes.has(id);
    }

    /**
     * One circle changed in place. A change of zIndex reorders the list and
     * needs {@link setCircles} instead; everything else is applied here.
     */
    update(state: CircleState): void {
        this.shapes.update(state);
    }

    /**
     * Takes one circle out of the tiles. Its slot in the worker's list is left
     * empty, so the others keep their indices and only the tiles it was in are
     * drawn again.
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
