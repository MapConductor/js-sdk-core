import { GeoRectBounds, createGeoRectBounds } from "../features";
import { interpolate } from "../sperical/GeographicLibCalculator";
import { PolylineFingerPrint, PolylineState } from "./PolylineState";

export interface PolylineEntity<ActualPolyline> {
    readonly polyline: ActualPolyline;
    readonly state: PolylineState;
    readonly fingerPrint: PolylineFingerPrint;
    readonly bounds: GeoRectBounds;
}

export function createPolylineEntity<ActualPolyline>(params: {
    polyline: ActualPolyline;
    state: PolylineState;
}): PolylineEntity<ActualPolyline> {
    const { polyline, state } = params;
    let cachedBounds: GeoRectBounds | null = null;
    let boundsFingerprint: number | null = null;

    const entity: PolylineEntity<ActualPolyline> = {
        polyline,
        state,
        fingerPrint: state.fingerPrint(),
        get bounds(): GeoRectBounds {
            const currentFp = state.points.length ^ (state.geodesic ? 1 : 0);
            if (cachedBounds == null || boundsFingerprint !== currentFp) {
                cachedBounds = calculateBounds(state);
                boundsFingerprint = currentFp;
            }
            return cachedBounds;
        },
    };
    return entity;
}

function calculateBounds(state: PolylineState): GeoRectBounds {
    const bounds = createGeoRectBounds({ southWest: null, northEast: null });
    const pts = state.points;
    if (pts.length === 0) return bounds;

    if (!state.geodesic) {
        for (const p of pts) bounds.extend(p);
        return bounds;
    }

    bounds.extend(pts[0]);
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const samples = 32;
        for (let s = 1; s <= samples; s++) {
            const f = s / samples;
            bounds.extend(interpolate({ from: p1, to: p2, fraction: f }));
        }
    }
    return bounds;
}
