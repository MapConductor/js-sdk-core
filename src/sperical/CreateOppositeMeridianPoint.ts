import { createGeoPoint, GeoPoint } from "../features/GeoPoint";

export function createOppositeMeridianPoint(point: GeoPoint): GeoPoint {
    const oppositeLongitude = point.longitude >= 0 ? -180.0 : 180.0;

    return createGeoPoint({
        latitude: point.latitude,
        longitude: oppositeLongitude,
        altitude: point.altitude ?? 0.0,
    });
}
