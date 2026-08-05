import { GeoPoint } from "../features/GeoPoint";
import { computeDistanceBetween } from "./WGS84Geodesic";
import { planarInterpolate as linearInterpolate } from "./_PlanarInterpolate";

/**
 * 非測地線（直線補間）の点列を密度化する。
 *
 * 分割数はセグメント長に応じて決める（createInterpolatePoints と同じ方式）。固定分割だと
 * 短いセグメントが多い多頂点ポリゴンで点数が頂点数×分割数に膨れ上がり、描画が極端に
 * 遅くなるため、maxSegmentLength を超えるセグメントのみ分割する。
 * android-sdk / ios-sdk と同一仕様。
 */
export function createLinearInterpolatePoints(
    points: GeoPoint[],
    maxSegmentLength: number = 10000.0,
): GeoPoint[] {
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
            results.push(
                linearInterpolate({ from: points[i - 1], to: points[i], fraction }),
            );
            fraction += step;
        }
        results.push(points[i]);
    }

    return results;
}
