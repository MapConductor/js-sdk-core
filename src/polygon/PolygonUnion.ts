import polygonClipping, { type Polygon as ClippingPolygon, type Ring } from 'polygon-clipping';
import { createGeoPoint, type GeoPoint } from '../features';
import type { PolygonState } from './PolygonState';

/**
 * Unions overlapping hole rings in a planar lon/lat coordinate space.
 * Mirrors Android's PolygonState.unionHoles(), which uses JTS CascadedPolygonUnion.
 */
export function unionHoleRings(holes: GeoPoint[][]): GeoPoint[][] {
    if (holes.length <= 1) return holes;

    const clippingPolygons = holes
        .map(toClippingPolygon)
        .filter((polygon): polygon is ClippingPolygon => polygon != null);
    if (clippingPolygons.length <= 1) return holes;

    try {
        const [first, ...rest] = clippingPolygons;
        const unioned = polygonClipping.union(first, ...rest);
        const nextHoles = unioned
            .map(polygon => clippingRingToGeoPoints(polygon[0]))
            .filter(ring => ring.length >= 3);

        if (nextHoles.length === 0) return holes;

        return nextHoles.map(ring => {
            const area = signedArea(ring);
            return area > 0 ? [...ring].reverse() : ring;
        });
    } catch {
        return holes;
    }
}

/**
 * Unions overlapping hole rings and returns a copied PolygonState when changed.
 */
export function unionHoles(state: PolygonState): PolygonState {
    const normalizedHoles = unionHoleRings(state.holes);
    if (normalizedHoles === state.holes) return state;
    return state.copy({ holes: normalizedHoles });
}

/** Alias: in-place mutation variant. */
export function unionHolesInPlace(state: PolygonState): PolygonState {
    const merged = unionHoles(state);
    if (merged !== state) {
        state.holes = merged.holes;
    }
    return state;
}

function toClippingPolygon(ring: GeoPoint[]): ClippingPolygon | null {
    const open = openRing(ring).filter(point =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );
    if (open.length < 3) return null;

    const clippingRing: Ring = open.map(point => [point.longitude, point.latitude]);
    const first = clippingRing[0];
    const last = clippingRing[clippingRing.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        clippingRing.push([first[0], first[1]]);
    }
    return [clippingRing];
}

function clippingRingToGeoPoints(ring: Ring | undefined): GeoPoint[] {
    if (!ring || ring.length < 4) return [];
    const points = ring.map(([longitude, latitude]) => createGeoPoint({ latitude, longitude }));
    const first = points[0];
    const last = points[points.length - 1];
    if (first.latitude === last.latitude && first.longitude === last.longitude) {
        points.pop();
    }
    return points.length >= 3 ? points : [];
}

function openRing(ring: GeoPoint[]): GeoPoint[] {
    if (ring.length < 2) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first.latitude === last.latitude && first.longitude === last.longitude
        ? ring.slice(0, -1)
        : ring;
}

function signedArea(ring: GeoPoint[]): number {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        area += a.longitude * b.latitude - b.longitude * a.latitude;
    }
    return area / 2;
}
