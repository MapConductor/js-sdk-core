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

    const totalLngDiff = toLng - fromLng;
    const meridianDiff = targetMeridian - fromLng;
    const fraction = meridianDiff / totalLngDiff;

    return createGeoPoint({
        latitude: from.latitude + fraction * (to.latitude - from.latitude),
        longitude: targetMeridian,
        altitude: interpolateAltitude({ from, to, fraction }),
    });
}
