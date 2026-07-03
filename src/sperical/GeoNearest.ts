import { createGeoPoint, GeoPoint } from "../features/GeoPoint";
import { Earth } from "../projection/Earth";
import { computeDistanceBetween } from "./Spherical";

export interface ClosestHit {
    radiusMeters: number;
    hit: GeoPoint;
    mode: string;
}

const DEG = Math.PI / 180.0;
const EPS = 1e-12;

type Vector3 = [number, number, number];

function normalizeLongitude(dlon: number): number {
    let x = dlon;
    while (x > 180.0) x -= 360.0;
    while (x < -180.0) x += 360.0;
    return x;
}

function normalizeLon180(lon: number): number {
    let x = lon;
    while (x > 180.0) x -= 360.0;
    while (x < -180.0) x += 360.0;
    return x;
}

function toUnitVec(point: GeoPoint): Vector3 {
    const phi = point.latitude * DEG;
    const lam = point.longitude * DEG;
    const c = Math.cos(phi);
    return [c * Math.cos(lam), c * Math.sin(lam), Math.sin(phi)];
}

function toGeoPoint(v: Vector3): GeoPoint {
    const [x, y, z] = v;
    const r = Math.max(EPS, Math.sqrt(x * x + y * y + z * z));
    const zn = Math.max(-1.0, Math.min(1.0, z / r));
    return createGeoPoint({
        latitude: Math.asin(zn) / DEG,
        longitude: normalizeLon180(Math.atan2(y, x) / DEG),
    });
}

function cross(u: Vector3, v: Vector3): Vector3 {
    return [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
}

function dot(u: Vector3, v: Vector3): number {
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

function norm(u: Vector3): number {
    return Math.sqrt(dot(u, u));
}

function scale(u: Vector3, s: number): Vector3 {
    return [u[0] * s, u[1] * s, u[2] * s];
}

function normalize(u: Vector3): Vector3 {
    const n = norm(u);
    return n < EPS ? [1.0, 0.0, 0.0] : scale(u, 1.0 / n);
}

function clamp({
    x,
    lo,
    hi,
}: {
    x: number;
    lo: number;
    hi: number;
}): number {
    return Math.max(lo, Math.min(hi, x));
}

function endpointChoice({
    p,
    aPoint,
    bPoint,
    mode,
}: {
    p: Vector3;
    aPoint: GeoPoint;
    bPoint: GeoPoint;
    mode: string;
}): ClosestHit {
    const a = toUnitVec(aPoint);
    const b = toUnitVec(bPoint);
    const dPA = Math.acos(clamp({ x: dot(p, a), lo: -1.0, hi: 1.0 }));
    const dPB = Math.acos(clamp({ x: dot(p, b), lo: -1.0, hi: 1.0 }));
    const chosen = dPA <= dPB ? aPoint : bPoint;
    const meters = Math.min(dPA, dPB) * Earth.RADIUS_METERS;
    return { radiusMeters: meters, hit: chosen, mode };
}

function planarNearest({
    pPoint,
    aPoint,
    bPoint,
}: {
    pPoint: GeoPoint;
    aPoint: GeoPoint;
    bPoint: GeoPoint;
}): ClosestHit {
    const phi0 = pPoint.latitude * DEG;
    const kx = Earth.RADIUS_METERS * Math.cos(phi0) * DEG;
    const ky = Earth.RADIUS_METERS * DEG;

    const toLocalXY = (point: GeoPoint): [number, number] => [
        normalizeLongitude(point.longitude - pPoint.longitude) * kx,
        (point.latitude - pPoint.latitude) * ky,
    ];

    const toLocalGeoPoint = (x: number, y: number): GeoPoint => createGeoPoint({
        latitude: pPoint.latitude + (y / ky),
        longitude: normalizeLon180(pPoint.longitude + (x / kx)),
    });

    const [ax, ay] = toLocalXY(aPoint);
    const [bx, by] = toLocalXY(bPoint);
    const testPointX = 0.0;
    const testPointY = 0.0;

    const segmentVectorX = bx - ax;
    const segmentVectorY = by - ay;
    const pointVectorX = testPointX - ax;
    const pointVectorY = testPointY - ay;
    const segmentLengthSquared = segmentVectorX * segmentVectorX + segmentVectorY * segmentVectorY;

    const t = segmentLengthSquared < EPS ?
        0.0 :
        clamp({ x: (pointVectorX * segmentVectorX + pointVectorY * segmentVectorY) / segmentLengthSquared, lo: 0.0, hi: 1.0 });
    const projectionX = ax + t * segmentVectorX;
    const projectionY = ay + t * segmentVectorY;

    const deltaX = projectionX - testPointX;
    const deltaY = projectionY - testPointY;
    const d = Math.hypot(deltaX, deltaY);
    const hitLL = toLocalGeoPoint(projectionX, projectionY);

    return { radiusMeters: d, hit: hitLL, mode: "planar" };
}

function sphericalNearest({
    pPoint,
    aPoint,
    bPoint,
}: {
    pPoint: GeoPoint;
    aPoint: GeoPoint;
    bPoint: GeoPoint;
}): ClosestHit {
    const p = toUnitVec(pPoint);
    const a = toUnitVec(aPoint);
    const b = toUnitVec(bPoint);

    const n = cross(a, b);
    const nNorm = norm(n);
    if (nNorm < 1e-15) {
        return endpointChoice({ p, aPoint, bPoint, mode: "spherical" });
    }
    const nHat = scale(n, 1.0 / nNorm);
    const q = normalize(cross(nHat, cross(p, nHat)));

    const dAB = Math.acos(clamp({ x: dot(a, b), lo: -1.0, hi: 1.0 }));
    const dAQ = Math.acos(clamp({ x: dot(a, q), lo: -1.0, hi: 1.0 }));
    const dQB = Math.acos(clamp({ x: dot(q, b), lo: -1.0, hi: 1.0 }));
    const onArc = Math.abs((dAQ + dQB) - dAB) <= 1e-12;

    const chosenQ = onArc ?
        q :
        Math.acos(clamp({ x: dot(p, a), lo: -1.0, hi: 1.0 })) <= Math.acos(clamp({ x: dot(p, b), lo: -1.0, hi: 1.0 })) ? a : b;

    const delta = Math.acos(clamp({ x: dot(p, chosenQ), lo: -1.0, hi: 1.0 }));
    const meters = delta * Earth.RADIUS_METERS;
    const hitLL = toGeoPoint(chosenQ);

    return { radiusMeters: meters, hit: hitLL, mode: "spherical" };
}

export function closestIntersection({
    p,
    a,
    b,
}: {
    p: GeoPoint;
    a: GeoPoint;
    b: GeoPoint;
}): ClosestHit {
    const dPA = computeDistanceBetween(p, a);
    const dPB = computeDistanceBetween(p, b);
    const dAB = computeDistanceBetween(a, b);
    const maxSpan = Math.max(dAB, Math.max(dPA, dPB));

    return maxSpan <= 50_000.0 ?
        planarNearest({ pPoint: p, aPoint: a, bPoint: b }) :
        sphericalNearest({ pPoint: p, aPoint: a, bPoint: b });
}
