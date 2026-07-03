import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { Earth } from "../projection/Earth";
import { toDegrees, toRadians } from "./utils";

const RAD_TO_DEG = 180.0 / Math.PI;
const DEG_TO_RAD = Math.PI / 180.0;

function normalizeLng(lng: number): number {
    return ((((lng + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
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

export function computeDistanceBetween(from: GeoPoint, to: GeoPoint): number {
    const lat1Rad = from.latitude * DEG_TO_RAD;
    const lat2Rad = to.latitude * DEG_TO_RAD;
    const deltaLat = (to.latitude - from.latitude) * DEG_TO_RAD;
    const deltaLng = (to.longitude - from.longitude) * DEG_TO_RAD;

    const haversineA =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const centralAngle = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));
    return Earth.RADIUS_METERS * centralAngle;
}

export function computeHeading(from: GeoPoint, to: GeoPoint): number {
    const lat1Rad = from.latitude * DEG_TO_RAD;
    const lat2Rad = to.latitude * DEG_TO_RAD;
    const deltaLng = (to.longitude - from.longitude) * DEG_TO_RAD;

    const deltaY = Math.sin(deltaLng) * Math.cos(lat2Rad);
    const deltaX =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLng);

    let heading = Math.atan2(deltaY, deltaX) * RAD_TO_DEG;
    while (heading > 180) heading -= 360;
    while (heading <= -180) heading += 360;

    return heading;
}

export function computeOffset({
    origin,
    distance,
    heading,
}: {
    origin: GeoPoint;
    distance: number;
    heading: number;
}): GeoPoint {
    const distanceRad = distance / Earth.RADIUS_METERS;
    const headingRad = heading * DEG_TO_RAD;
    const lat1Rad = origin.latitude * DEG_TO_RAD;
    const lng1Rad = origin.longitude * DEG_TO_RAD;

    const lat2Rad = Math.asin(
        Math.sin(lat1Rad) * Math.cos(distanceRad) +
        Math.cos(lat1Rad) * Math.sin(distanceRad) * Math.cos(headingRad),
    );

    const lng2Rad =
        lng1Rad +
        Math.atan2(
            Math.sin(headingRad) * Math.sin(distanceRad) * Math.cos(lat1Rad),
            Math.cos(distanceRad) - Math.sin(lat1Rad) * Math.sin(lat2Rad),
        );

    return createGeoPoint({
        latitude: lat2Rad * RAD_TO_DEG,
        longitude: lng2Rad * RAD_TO_DEG,
        altitude: origin.altitude ?? 0.0,
    });
}

export function computeOffsetOrigin({
    to,
    distance,
    heading,
}: {
    to: GeoPoint;
    distance: number;
    heading: number;
}): GeoPoint | null {
    const reverseHeading = (heading + 180) % 360;

    try {
        return computeOffset({ origin: to, distance, heading: reverseHeading });
    } catch {
        return null;
    }
}

export function computeLength(path: GeoPoint[]): number {
    if (path.length < 2) return 0.0;

    let length = 0.0;
    for (let i = 1; i < path.length; i += 1) {
        length += computeDistanceBetween(path[i - 1], path[i]);
    }

    return length;
}

export function computeArea(path: GeoPoint[]): number {
    return Math.abs(computeSignedArea(path));
}

export function computeSignedArea(path: GeoPoint[]): number {
    if (path.length < 3) return 0.0;

    let area = 0.0;
    const pointCount = path.length;

    for (let i = 0; i < path.length; i += 1) {
        const j = (i + 1) % pointCount;
        const lat1 = path[i].latitude * DEG_TO_RAD;
        const lat2 = path[j].latitude * DEG_TO_RAD;
        const deltaLng = (path[j].longitude - path[i].longitude) * DEG_TO_RAD;

        area += deltaLng * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    return area * Earth.RADIUS_METERS * Earth.RADIUS_METERS / 2.0;
}

export function sphericalInterpolate({
    from,
    to,
    fraction,
}: {
    from: GeoPoint;
    to: GeoPoint;
    fraction: number;
}): GeoPoint {
    const lat1 = toRadians(from.latitude);
    const lng1 = toRadians(from.longitude);
    const lat2 = toRadians(to.latitude);
    const lng2 = toRadians(to.longitude);

    const x1 = Math.cos(lat1) * Math.cos(lng1);
    const y1 = Math.cos(lat1) * Math.sin(lng1);
    const z1 = Math.sin(lat1);

    const x2 = Math.cos(lat2) * Math.cos(lng2);
    const y2 = Math.cos(lat2) * Math.sin(lng2);
    const z2 = Math.sin(lat2);

    const dot = x1 * x2 + y1 * y2 + z1 * z2;
    const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

    if (angle < 1e-6) {
        return createGeoPoint({
            latitude: from.latitude + fraction * (to.latitude - from.latitude),
            longitude: from.longitude + fraction * (to.longitude - from.longitude),
            altitude: interpolateAltitude({ from, to, fraction }),
        });
    }

    const sinAngle = Math.sin(angle);
    const weightFrom = Math.sin((1 - fraction) * angle) / sinAngle;
    const weightTo = Math.sin(fraction * angle) / sinAngle;

    const vectorX = weightFrom * x1 + weightTo * x2;
    const vectorY = weightFrom * y1 + weightTo * y2;
    const vectorZ = weightFrom * z1 + weightTo * z2;

    return createGeoPoint({
        latitude: toDegrees(Math.asin(vectorZ)),
        longitude: toDegrees(Math.atan2(vectorY, vectorX)),
        altitude: interpolateAltitude({ from, to, fraction }),
    });
}

export function linearInterpolate({
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
        altitude: interpolateAltitude({ from, to, fraction }),
    });
}
