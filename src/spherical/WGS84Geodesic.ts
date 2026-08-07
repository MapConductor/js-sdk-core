import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { Earth } from "../projection/Earth";
import { toDegrees, toRadians } from "./utils";

// Path operations that follow the geodesic curve, exposed as WGS84Geodesic.* .
export { densifyAlongGeodesic as createInterpolatePoints } from "./CreateInterpolatePoints";
export { geodesicPointOnLineOrNull as pointOnLineOrNull } from "./PointOnGeodesicLineOrNull";

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
    // ios-sdk と同じく非収束の病的入力での無限ループを防ぐ反復上限。
    let iterLimit = 1000;

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
        iterLimit--;
    } while (Math.abs(sigma - sigmaP) > 1e-12 && iterLimit > 0);

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

export function computeHeading(from: GeoPoint, to: GeoPoint): number {
    return inverseGeodesic(from, to).initialBearing;
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
    return directGeodesic({
        origin,
        distance,
        heading,
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
    return computeOffset({ origin: to, distance, heading: reverseHeading });
}

export function computeLength(path: GeoPoint[]): number {
    if (path.length < 2) return 0.0;

    let length = 0.0;
    for (let i = 1; i < path.length; i += 1) {
        length += computeDistanceBetween(path[i - 1], path[i]);
    }

    return length;
}

// ── Ellipsoidal (authalic-sphere) polygon area ──────────────────────────────
// Geodetic latitudes are mapped to authalic latitudes on the equal-area sphere
// of radius AUTHALIC_RADIUS (which reproduces the exact WGS84 surface area), then
// the spherical-excess formula is applied. This accounts for flattening — unlike
// the sphere-based Spherical.computeArea — and matches the ellipsoidal area to
// well under 0.01% for typical polygons. Edges are treated as authalic-sphere
// arcs; the higher-order geodesic-edge terms of Karney's exact method are omitted.
const ECCENTRICITY_SQ = FLATTENING * (2 - FLATTENING);
const ECCENTRICITY = Math.sqrt(ECCENTRICITY_SQ);
const AUTHALIC_QP =
    1 - ((1 - ECCENTRICITY_SQ) / (2 * ECCENTRICITY)) *
        Math.log((1 - ECCENTRICITY) / (1 + ECCENTRICITY));
const AUTHALIC_RADIUS = Earth.RADIUS_METERS * Math.sqrt(AUTHALIC_QP / 2);

function authalicSinLatitude(latitudeDeg: number): number {
    const sinPhi = Math.sin(toRadians(latitudeDeg));
    const q =
        (1 - ECCENTRICITY_SQ) *
        (sinPhi / (1 - ECCENTRICITY_SQ * sinPhi * sinPhi) -
            (1 / (2 * ECCENTRICITY)) *
                Math.log((1 - ECCENTRICITY * sinPhi) / (1 + ECCENTRICITY * sinPhi)));
    return q / AUTHALIC_QP;
}

export function computeSignedArea(path: GeoPoint[]): number {
    if (path.length < 3) return 0.0;

    let area = 0.0;
    const pointCount = path.length;
    for (let i = 0; i < pointCount; i += 1) {
        const j = (i + 1) % pointCount;
        const sinXi1 = authalicSinLatitude(path[i].latitude);
        const sinXi2 = authalicSinLatitude(path[j].latitude);
        const deltaLng = toRadians(path[j].longitude - path[i].longitude);
        area += deltaLng * (2 + sinXi1 + sinXi2);
    }

    return area * AUTHALIC_RADIUS * AUTHALIC_RADIUS / 2.0;
}

export function computeArea(path: GeoPoint[]): number {
    return Math.abs(computeSignedArea(path));
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
