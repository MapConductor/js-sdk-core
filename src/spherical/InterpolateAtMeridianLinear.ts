import { createGeoPoint, GeoPoint } from "../features/GeoPoint";

function interpolateAltitude({
    from,
    to,
    fraction,
}: {
    from: GeoPoint;
    to: GeoPoint;
    fraction: number;
}): number {
    if (from.altitude != null && to.altitude != null) {
        return from.altitude + fraction * (to.altitude - from.altitude);
    }
    if (from.altitude != null) return from.altitude;
    if (to.altitude != null) return to.altitude;
    return 0.0;
}

export function interpolateAtMeridianLinear(from: GeoPoint, to: GeoPoint): GeoPoint {
    const fromLng = from.longitude;
    const toLng = to.longitude;
    const targetMeridian = fromLng >= 0 ? 180.0 : -180.0;

    // The raw difference exceeds 180° for an antimeridian-crossing segment (the
    // only case this function is called for), so unwrap it to the short-way
    // signed span; otherwise the fraction comes out negative and the latitude is
    // extrapolated in the wrong direction.
    const directDiff = toLng - fromLng;
    const totalLngDiff =
        directDiff > 180.0
            ? directDiff - 360.0
            : directDiff < -180.0
              ? directDiff + 360.0
              : directDiff;
    const meridianDiff = targetMeridian - fromLng;
    const fraction =
        totalLngDiff === 0 ? 0 : Math.min(1, Math.max(0, meridianDiff / totalLngDiff));

    return createGeoPoint({
        latitude: from.latitude + fraction * (to.latitude - from.latitude),
        longitude: targetMeridian,
        altitude: interpolateAltitude({ from, to, fraction }),
    });
}
