import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { Earth } from "../projection/Earth";
import { toDegrees, toRadians } from "./utils";

export function calculatePositionAtDistance({
    center,
    distanceMeters,
    bearingDegrees,
}: {
    center: GeoPoint;
    distanceMeters: number;
    bearingDegrees: number;
}): GeoPoint {
    const earthRadiusKm = Earth.RADIUS_METERS / 1000;
    const distanceKm = distanceMeters / 1000.0;
    const bearingRad = toRadians(bearingDegrees);

    const lat1Rad = toRadians(center.latitude);
    const lng1Rad = toRadians(center.longitude);

    const lat2Rad = Math.asin(
        Math.sin(lat1Rad) * Math.cos(distanceKm / earthRadiusKm) +
        Math.cos(lat1Rad) * Math.sin(distanceKm / earthRadiusKm) * Math.cos(bearingRad),
    );

    const lng2Rad =
        lng1Rad +
        Math.atan2(
            Math.sin(bearingRad) * Math.sin(distanceKm / earthRadiusKm) * Math.cos(lat1Rad),
            Math.cos(distanceKm / earthRadiusKm) - Math.sin(lat1Rad) * Math.sin(lat2Rad),
        );

    return createGeoPoint({
        latitude: toDegrees(lat2Rad),
        longitude: toDegrees(lng2Rad),
    });
}
