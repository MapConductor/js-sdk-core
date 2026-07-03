import { createGeoPoint, GeoPoint } from "../features/GeoPoint";

export type PointDistancePair = [GeoPoint, number];

interface MeterPoint {
    x: number;
    y: number;
}

function normalizeLng(lng: number): number {
    return ((((lng + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
}

function unwrapLngRelative(baseLng: number, targetLng: number): number {
    let diff = targetLng - baseLng;
    while (diff > 180.0) diff -= 360.0;
    while (diff < -180.0) diff += 360.0;
    return baseLng + diff;
}

function interpolateEndpointAltitude(from: GeoPoint, to: GeoPoint): number {
    if (from.altitude != null) return from.altitude;
    if (to.altitude != null) return to.altitude;
    return 0.0;
}

function interpolateAltitude({
    from,
    to,
    t,
}: {
    from: GeoPoint;
    to: GeoPoint;
    t: number;
}): number {
    if (from.altitude != null && to.altitude != null) {
        return from.altitude + t * (to.altitude - from.altitude);
    }
    if (from.altitude != null) return from.altitude;
    if (to.altitude != null) return to.altitude;
    return 0.0;
}

export function isPointOnLinearLine({
    from,
    to,
    position,
    thresholdMeters,
}: {
    from: GeoPoint;
    to: GeoPoint;
    position: GeoPoint;
    thresholdMeters: number;
}): PointDistancePair | null {
    const fromLng = from.longitude;
    const toLng = to.longitude;
    const directDiff = toLng - fromLng;
    const crossMeridianDiff =
        directDiff > 180.0 ? directDiff - 360.0 :
        directDiff < -180.0 ? directDiff + 360.0 :
        directDiff;
    const toLngUnwrapped = fromLng + crossMeridianDiff;
    const posLngUnwrapped = unwrapLngRelative(fromLng, position.longitude);

    const lat0Rad = (Math.PI / 180.0) * ((from.latitude + to.latitude) / 2.0);
    const metersPerDegLat = 111_132.954;
    const metersPerDegLng = metersPerDegLat * Math.cos(lat0Rad);

    const toMetersPoint = (lat: number, lng: number): MeterPoint => ({
        x: lng * metersPerDegLng,
        y: lat * metersPerDegLat,
    });

    const a = toMetersPoint(from.latitude, fromLng);
    const b = toMetersPoint(to.latitude, toLngUnwrapped);
    const pp = toMetersPoint(position.latitude, posLngUnwrapped);

    const segmentVectorX = b.x - a.x;
    const segmentVectorY = b.y - a.y;
    const pointVectorX = pp.x - a.x;
    const pointVectorY = pp.y - a.y;
    const segmentLengthSquared = segmentVectorX * segmentVectorX + segmentVectorY * segmentVectorY;

    if (segmentLengthSquared === 0.0) {
        const deltaX = pp.x - a.x;
        const deltaY = pp.y - a.y;
        const d = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (d > thresholdMeters) return null;

        return [
            createGeoPoint({
                latitude: from.latitude,
                longitude: normalizeLng(fromLng),
                altitude: interpolateEndpointAltitude(from, to),
            }),
            d,
        ];
    }

    const t = Math.max(
        0.0,
        Math.min(1.0, (pointVectorX * segmentVectorX + pointVectorY * segmentVectorY) / segmentLengthSquared),
    );
    const projectionX = a.x + t * segmentVectorX;
    const projectionY = a.y + t * segmentVectorY;
    const deltaX = pp.x - projectionX;
    const deltaY = pp.y - projectionY;
    const distanceMeters = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    const latitude = from.latitude + t * (to.latitude - from.latitude);
    const longitude = fromLng + t * crossMeridianDiff;

    if (distanceMeters > thresholdMeters) return null;

    return [
        createGeoPoint({
            latitude,
            longitude: normalizeLng(longitude),
            altitude: interpolateAltitude({ from, to, t }),
        }),
        distanceMeters,
    ];
}
