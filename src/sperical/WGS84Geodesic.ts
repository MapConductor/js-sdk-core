import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { Earth } from "../projection/Earth";
import { toDegrees, toRadians } from "./utils";

const FLATTENING = 1.0 / 298.257223563;
const SEMI_MINOR_AXIS = Earth.RADIUS_METERS * (1.0 - FLATTENING);

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
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const lon1 = toRadians(from.longitude);
    const lon2 = toRadians(to.longitude);

    const longitudeDifference = lon2 - lon1;
    const reducedLatitude1 = Math.atan((1 - FLATTENING) * Math.tan(lat1));
    const reducedLatitude2 = Math.atan((1 - FLATTENING) * Math.tan(lat2));
    const sinU1 = Math.sin(reducedLatitude1);
    const cosU1 = Math.cos(reducedLatitude1);
    const sinU2 = Math.sin(reducedLatitude2);
    const cosU2 = Math.cos(reducedLatitude2);

    let lambda = longitudeDifference;
    let lambdaP: number;
    let iterLimit = 100;
    let cosSqAlpha = 0.0;
    let sinSigma = 0.0;
    let cos2SigmaM = 0.0;
    let cosSigma = 0.0;
    let sigma = 0.0;

    do {
        const sinLambda = Math.sin(lambda);
        const cosLambda = Math.cos(lambda);
        sinSigma = Math.sqrt(
            (cosU2 * sinLambda) * (cosU2 * sinLambda) +
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) *
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda),
        );

        if (sinSigma === 0.0) return 0.0;

        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);
        const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;

        if (Number.isNaN(cos2SigmaM)) cos2SigmaM = 0.0;

        const correctionFactor = FLATTENING / 16 * cosSqAlpha * (4 + FLATTENING * (4 - 3 * cosSqAlpha));
        lambdaP = lambda;
        lambda =
            longitudeDifference +
            (1 - correctionFactor) * FLATTENING * sinAlpha *
            (
                sigma +
                correctionFactor * sinSigma *
                (cos2SigmaM + correctionFactor * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
            );
        iterLimit -= 1;
    } while (Math.abs(lambda - lambdaP) > 1e-12 && iterLimit > 0);

    if (iterLimit === 0) return 0.0;

    const uSq =
        cosSqAlpha * (Earth.RADIUS_METERS * Earth.RADIUS_METERS - SEMI_MINOR_AXIS * SEMI_MINOR_AXIS) /
        (SEMI_MINOR_AXIS * SEMI_MINOR_AXIS);
    const ellipsoidFactor = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const correctionTerm = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma =
        correctionTerm * sinSigma * (
            cos2SigmaM + correctionTerm / 4 * (
                cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
                correctionTerm / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) *
                (-3 + 4 * cos2SigmaM * cos2SigmaM)
            )
        );

    return SEMI_MINOR_AXIS * ellipsoidFactor * (sigma - deltaSigma);
}

export function computeHeading(from: GeoPoint, to: GeoPoint): number {
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const dLon = toRadians(to.longitude - from.longitude);

    const yComponent = Math.sin(dLon) * Math.cos(lat2);
    const xComponent =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let heading = toDegrees(Math.atan2(yComponent, xComponent));
    while (heading > 180) heading -= 360;
    while (heading <= -180) heading += 360;

    return heading;
}

export function interpolate({
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
    const sinAngle = Math.sin(angle);
    const firstWeight = Math.sin((1 - fraction) * angle) / sinAngle;
    const secondWeight = Math.sin(fraction * angle) / sinAngle;

    const xInterpolated = firstWeight * x1 + secondWeight * x2;
    const yInterpolated = firstWeight * y1 + secondWeight * y2;
    const zInterpolated = firstWeight * z1 + secondWeight * z2;

    return createGeoPoint({
        latitude: toDegrees(Math.asin(zInterpolated)),
        longitude: toDegrees(Math.atan2(yInterpolated, xInterpolated)),
        altitude: interpolateAltitude({ from, to, fraction }),
    });
}
