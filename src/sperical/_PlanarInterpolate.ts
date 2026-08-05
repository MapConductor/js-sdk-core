import { createGeoPoint, GeoPoint } from "../features/GeoPoint";

// Internal: straight lat/lng ("planar") interpolation. Exposed publicly as
// `Planar.interpolate`. Kept in its own module so both `Planar` and
// `CreateLinearInterpolatePoints` can use it without an import cycle.

function normalizeLng(lng: number): number {
    return ((((lng + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
}

function interpolateAltitude(from: GeoPoint, to: GeoPoint, fraction: number): number {
    if (from.altitude != null && to.altitude != null) {
        return from.altitude + fraction * (to.altitude - from.altitude);
    }
    if (from.altitude != null) return from.altitude;
    if (to.altitude != null) return to.altitude;
    return 0.0;
}

export function planarInterpolate({
    from,
    to,
    fraction,
}: {
    from: GeoPoint;
    to: GeoPoint;
    fraction: number;
}): GeoPoint {
    const interpolatedLatitude = from.latitude + fraction * (to.latitude - from.latitude);

    const fromLng = from.longitude;
    const toLng = to.longitude;
    const directDiff = toLng - fromLng;
    const crossMeridianDiff =
        directDiff > 180 ? directDiff - 360 :
        directDiff < -180 ? directDiff + 360 :
        directDiff;

    const interpolatedLongitude = fromLng + fraction * crossMeridianDiff;

    return createGeoPoint({
        latitude: interpolatedLatitude,
        longitude: normalizeLng(interpolatedLongitude),
        altitude: interpolateAltitude(from, to, fraction),
    });
}
