import { Earth } from '../projection/Earth';
import { normalizeLngDegrees } from '../geometry/CircleGeometry';

const DEG = Math.PI / 180;

/**
 * The latitudes and longitudes a circle spans, in degrees, as the ring the map
 * SDKs draw (`circleToRing`) spans them, whatever the zoom. The longitudes are
 * round the centre's in [-180, 180] and may run past ±180. Null when the circle
 * goes over a pole (a geodesic one whose radius reaches it).
 * @internal
 */
export function circleTileExtentOf(
    latitude: number,
    lng: number,
    r: number,
    geodesic: boolean,
): { north: number; south: number; west: number; east: number } | null {
    const longitude = normalizeLngDegrees(lng);
    let dLat: number;
    let dLng: number;
    if (geodesic) {
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
