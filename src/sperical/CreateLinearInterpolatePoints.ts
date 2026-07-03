import { GeoPoint } from "../features/GeoPoint";
import { linearInterpolate } from "./Spherical";

export function createLinearInterpolatePoints(points: GeoPoint[], fractionStep: number = 0.01): GeoPoint[] {
    if (points.length === 0) {
        throw new RangeError("points must contain at least one point");
    }

    const results: GeoPoint[] = [];
    results.push(points[0]);

    for (let i = 1; i < points.length; i += 1) {
        let fraction = fractionStep;
        while (fraction <= 1.0) {
            results.push(linearInterpolate({ from: points[i - 1], to: points[i], fraction }));
            fraction += fractionStep;
        }
        results.push(points[i]);
    }

    return results;
}
