import { GeoPoint } from "../features/GeoPoint";
import { computeDistanceBetween, interpolate } from "./GeographicLibCalculator";

export function createInterpolatePoints(points: GeoPoint[], maxSegmentLength: number = 10000.0): GeoPoint[] {
    if (points.length === 0) {
        throw new RangeError("points must contain at least one point");
    }

    const results: GeoPoint[] = [];
    results.push(points[0]);

    for (let i = 1; i < points.length; i += 1) {
        const distance = computeDistanceBetween(points[i - 1], points[i]);
        const numSegments = Math.max(Math.trunc(distance / maxSegmentLength), 1);
        const step = 1.0 / numSegments;

        let fraction = step;
        while (fraction < 1.0) {
            results.push(interpolate({ from: points[i - 1], to: points[i], fraction }));
            fraction += step;
        }
        results.push(points[i]);
    }

    return results;
}
