import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { sphericalInterpolate } from "./Spherical";

export function interpolateAtMeridianGeodesic(from: GeoPoint, to: GeoPoint): GeoPoint {
    const fromLng = from.longitude;
    const targetMeridian = fromLng >= 0 ? 180.0 : -180.0;

    let low = 0.0;
    let high = 1.0;
    const tolerance = 1e-10;
    const maxIterations = 50;

    let iteration = 0;
    while (iteration < maxIterations && (high - low) > tolerance) {
        const mid = (low + high) / 2.0;
        const interpolatedPoint = sphericalInterpolate({ from, to, fraction: mid });
        const interpolatedLng = interpolatedPoint.longitude;

        const normalizedLng =
            interpolatedLng > 180 ? interpolatedLng - 360 :
            interpolatedLng <= -180 ? interpolatedLng + 360 :
            interpolatedLng;

        const onTargetSide = targetMeridian > 0 ? normalizedLng >= 0 : normalizedLng < 0;
        const fromOnTargetSide = targetMeridian > 0 ? fromLng >= 0 : fromLng < 0;

        if (onTargetSide === fromOnTargetSide) {
            low = mid;
        } else {
            high = mid;
        }

        iteration += 1;
    }

    const finalFraction = (low + high) / 2.0;
    const crossingPoint = sphericalInterpolate({ from, to, fraction: finalFraction });

    return createGeoPoint({
        latitude: crossingPoint.latitude,
        longitude: targetMeridian,
        altitude: crossingPoint.altitude,
    });
}
