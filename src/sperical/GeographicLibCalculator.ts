import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { Earth } from "../projection/Earth";
import { toDegrees, toRadians } from "./utils";

const FLATTENING = Earth.FLATTENING;
const SEMI_MINOR_AXIS = Earth.SEMI_MINOR_AXIS_METERS;

interface InverseResult {
    distance: number;
    initialBearing: number;
}

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

function sphericalFallbackInverse(from: GeoPoint, to: GeoPoint): InverseResult {
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const deltaLat = toRadians(to.latitude - from.latitude);
    const deltaLng = toRadians(to.longitude - from.longitude);
    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return {
        distance: Earth.RADIUS_METERS * centralAngle,
        initialBearing: toDegrees(Math.atan2(y, x)),
    };
}

function inverseGeodesic(from: GeoPoint, to: GeoPoint): InverseResult {
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

        if (sinSigma === 0.0) {
            return { distance: 0.0, initialBearing: 0.0 };
        }

        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);
        const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
        if (!Number.isFinite(cos2SigmaM)) cos2SigmaM = 0.0;

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

    if (iterLimit === 0) return sphericalFallbackInverse(from, to);

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

    const distance = SEMI_MINOR_AXIS * ellipsoidFactor * (sigma - deltaSigma);
    const initialBearing = Math.atan2(
        cosU2 * Math.sin(lambda),
        cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda),
    );

    return {
        distance,
        initialBearing: toDegrees(initialBearing),
    };
}

function directGeodesic({
    origin,
    distance,
    heading,
    altitude,
}: {
    origin: GeoPoint;
    distance: number;
    heading: number;
    altitude: number;
}): GeoPoint {
    const lat1 = toRadians(origin.latitude);
    const lon1 = toRadians(origin.longitude);
    const alpha1 = toRadians(heading);
    const sinAlpha1 = Math.sin(alpha1);
    const cosAlpha1 = Math.cos(alpha1);

    const tanU1 = (1 - FLATTENING) * Math.tan(lat1);
    const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
    const sinU1 = tanU1 * cosU1;
    const sigma1 = Math.atan2(tanU1, cosAlpha1);
    const sinAlpha = cosU1 * sinAlpha1;
    const cosSqAlpha = 1 - sinAlpha * sinAlpha;
    const uSq =
        cosSqAlpha * (Earth.RADIUS_METERS * Earth.RADIUS_METERS - SEMI_MINOR_AXIS * SEMI_MINOR_AXIS) /
        (SEMI_MINOR_AXIS * SEMI_MINOR_AXIS);
    const ellipsoidFactor = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const correctionTerm = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

    let sigma = distance / (SEMI_MINOR_AXIS * ellipsoidFactor);
    let sigmaP: number;
    let cos2SigmaM = 0.0;
    let sinSigma = 0.0;
    let cosSigma = 0.0;

    do {
        cos2SigmaM = Math.cos(2 * sigma1 + sigma);
        sinSigma = Math.sin(sigma);
        cosSigma = Math.cos(sigma);
        const deltaSigma =
            correctionTerm * sinSigma * (
                cos2SigmaM + correctionTerm / 4 * (
                    cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
                    correctionTerm / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) *
                    (-3 + 4 * cos2SigmaM * cos2SigmaM)
                )
            );
        sigmaP = sigma;
        sigma = distance / (SEMI_MINOR_AXIS * ellipsoidFactor) + deltaSigma;
    } while (Math.abs(sigma - sigmaP) > 1e-12);

    const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
    const lat2 = Math.atan2(
        sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
        (1 - FLATTENING) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp),
    );
    const lambda = Math.atan2(
        sinSigma * sinAlpha1,
        cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1,
    );
    const correctionFactor = FLATTENING / 16 * cosSqAlpha * (4 + FLATTENING * (4 - 3 * cosSqAlpha));
    const longitudeDifference =
        lambda - (1 - correctionFactor) * FLATTENING * sinAlpha *
        (
            sigma +
            correctionFactor * sinSigma *
            (cos2SigmaM + correctionFactor * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
        );
    const lon2 = lon1 + longitudeDifference;

    return createGeoPoint({
        latitude: toDegrees(lat2),
        longitude: normalizeLng(toDegrees(lon2)),
        altitude,
    });
}

export function computeDistanceBetween(from: GeoPoint, to: GeoPoint): number {
    return inverseGeodesic(from, to).distance;
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
    const line = inverseGeodesic(from, to);
    return directGeodesic({
        origin: from,
        distance: line.distance * fraction,
        heading: line.initialBearing,
        altitude: interpolateAltitude({ from, to, fraction }),
    });
}
