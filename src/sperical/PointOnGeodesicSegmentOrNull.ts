import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { computeDistanceBetween, interpolate } from "./GeographicLibCalculator";

export type GeodesicPointDistancePair = [GeoPoint, number];

function endpointAltitude(primary: GeoPoint, fallback: GeoPoint): number {
    if (primary.altitude != null) return primary.altitude;
    if (fallback.altitude != null) return fallback.altitude;
    return 0.0;
}

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

export function pointOnGeodesicSegmentOrNull({
    from,
    to,
    position,
    thresholdMeters,
}: {
    from: GeoPoint;
    to: GeoPoint;
    position: GeoPoint;
    thresholdMeters: number;
}): GeodesicPointDistancePair | null {
    const totalDistance = computeDistanceBetween(from, to);

    if (totalDistance === 0.0) {
        const distPosFrom = computeDistanceBetween(from, position);
        return distPosFrom <= thresholdMeters ?
            [
                createGeoPoint({
                    latitude: from.latitude,
                    longitude: from.longitude,
                    altitude: from.altitude ?? 0.0,
                }),
                distPosFrom,
            ] :
            null;
    }

    let left = 0.0;
    let right = 1.0;
    const epsilon = 1e-6;

    while (right - left > epsilon) {
        const m1 = left + (right - left) / 3.0;
        const m2 = right - (right - left) / 3.0;

        const point1 = interpolate({ from, to, fraction: m1 });
        const dist1 = computeDistanceBetween(point1, position);

        const point2 = interpolate({ from, to, fraction: m2 });
        const dist2 = computeDistanceBetween(point2, position);

        if (dist1 > dist2) {
            left = m1;
        } else {
            right = m2;
        }
    }

    const bestFraction = (left + right) / 2.0;

    if (bestFraction <= 0.0 || bestFraction >= 1.0) {
        const distFrom = computeDistanceBetween(from, position);
        const distTo = computeDistanceBetween(to, position);
        const actualMin = Math.min(distFrom, distTo);
        if (actualMin > thresholdMeters) return null;

        return [
            distFrom <= distTo ?
                createGeoPoint({
                    latitude: from.latitude,
                    longitude: from.longitude,
                    altitude: endpointAltitude(from, to),
                }) :
                createGeoPoint({
                    latitude: to.latitude,
                    longitude: to.longitude,
                    altitude: endpointAltitude(to, from),
                }),
            actualMin,
        ];
    }

    const closestPoint = interpolate({ from, to, fraction: bestFraction });
    const minDistance = computeDistanceBetween(closestPoint, position);

    if (minDistance > thresholdMeters) return null;

    return [
        createGeoPoint({
            latitude: closestPoint.latitude,
            longitude: closestPoint.longitude,
            altitude: interpolateAltitude({ from, to, fraction: bestFraction }),
        }),
        minDistance,
    ];
}
