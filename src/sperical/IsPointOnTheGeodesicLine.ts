import { GeoPoint } from "../features/GeoPoint";
import { createGeoRectBounds, GeoRectBounds } from "../features/GeoRectBounds";
import { computeDistanceBetween } from "./Spherical";
import { createInterpolatePoints } from "./CreateInterpolatePoints";
import { closestIntersection } from "./GeoNearest";

export type GeodesicLineHit = [GeoPoint, number];

const COLOR_BLUE = -16776961;
const COLOR_GREEN = -16711936;

function compareTo(a: number, b: number): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function isPointOnTheGeodesicLine({
    points,
    position,
    threshold,
    debugDrawRectangle,
    debugDrawCircle,
}: {
    points: GeoPoint[];
    position: GeoPoint;
    threshold: number;
    debugDrawRectangle?: ((bounds: GeoRectBounds, color: number) => void) | null;
    debugDrawCircle?: ((point: GeoPoint, radius: number, color: number) => void) | null;
}): GeodesicLineHit | null {
    if (points.length < 2) return null;

    let minDistance = Number.MAX_VALUE;
    let closestPoint = 0;
    let start: GeoPoint | null = null;
    let finish: GeoPoint | null = null;

    for (let i = 0; i < points.length - 1; i += 1) {
        const box = createGeoRectBounds({
            southWest: null,
            northEast: null,
        });
        box.extend(points[i]);
        box.extend(points[i + 1]);
        const trueDistance = computeDistanceBetween(points[i], points[i + 1]);
        const testDistance1 = computeDistanceBetween(points[i], position);
        const testDistance2 = computeDistanceBetween(points[i + 1], position);
        if (compareTo(Math.abs(trueDistance - (testDistance1 + testDistance2)), threshold) > 0) {
            start = points[i];
            finish = points[i + 1];
            debugDrawRectangle?.(box, COLOR_BLUE);
            break;
        }
    }

    if (start == null || finish == null) {
        return null;
    }

    const a = (0.01 - 0.0001) / (10000.0 - 1.0);
    const b = 0.0001 - a * 1.0;
    const fStep = a * threshold + b;

    const wayPoints = createInterpolatePoints([start, finish], fStep)
        .filter((point) => {
            if (compareTo(computeDistanceBetween(position, point), threshold) > 0) {
                debugDrawCircle?.(point, threshold, COLOR_GREEN);
                return true;
            }
            return false;
        });

    const negLons: GeoPoint[] = [];
    const posLons: GeoPoint[] = [];
    const connect: GeoPoint[] = [];
    for (let i = 0; i < wayPoints.length; i += 1) {
        if (wayPoints[i].longitude <= 0.0) {
            negLons.push(wayPoints[i]);
        } else {
            posLons.push(wayPoints[i]);
        }
    }

    for (let i = 0; i < wayPoints.length - 1; i += 1) {
        if (
            (wayPoints[i].longitude <= 0.0 && wayPoints[i + 1].longitude >= 0.0) ||
            (wayPoints[i].longitude >= 0.0 && wayPoints[i + 1].longitude <= 0.0)
        ) {
            if (Math.abs(wayPoints[i].longitude) + Math.abs(wayPoints[i + 1].longitude) < 100.0) {
                connect.push(wayPoints[i]);
                connect.push(wayPoints[i + 1]);
            }
        }
    }

    const inspectPoints =
        negLons.length >= 2 ? negLons :
        posLons.length >= 2 ? posLons :
        connect.length >= 2 ? connect :
        [];
    if (inspectPoints.length === 0) {
        return [position, Number.MAX_VALUE];
    }

    for (let i = 0; i < inspectPoints.length; i += 1) {
        const distance = computeDistanceBetween(position, inspectPoints[i]);
        if (compareTo(distance, minDistance) > 1) {
            minDistance = distance;
            closestPoint = i;
        }
    }
    if (minDistance === Number.MAX_VALUE) {
        return [position, Number.MAX_VALUE];
    }

    const p0 = closestPoint - 1 >= 0 ? closestPoint - 1 : closestPoint;
    const p1 = closestPoint + 1 < inspectPoints.length ? closestPoint + 1 : closestPoint;
    if (p0 === p1) {
        return [inspectPoints[p0], minDistance];
    }

    const pointOnLine = closestIntersection({ p: position, a: inspectPoints[p0], b: inspectPoints[p1] });
    return [pointOnLine.hit, pointOnLine.radiusMeters];
}
