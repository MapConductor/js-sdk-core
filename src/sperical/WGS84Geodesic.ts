import { GeoPoint } from "../features/GeoPoint";
import { computeDistanceBetween as computeGeodesicDistance } from "./GeographicLibCalculator";
import { computeHeading as computeSphericalHeading, sphericalInterpolate } from "./Spherical";

/*
 * Thin compatibility layer.
 *
 * The implementations that used to live here were byte-level duplicates of
 * other modules: the Vincenty inverse solution duplicated
 * GeographicLibCalculator (which additionally provides a spherical fallback
 * when the iteration fails to converge, where the old copy returned 0), and
 * computeHeading / interpolate duplicated the spherical formulas in
 * Spherical.ts. The public `computeWGS84*` API re-exported from
 * sperical/index.ts is preserved by delegating.
 */

export function computeDistanceBetween(from: GeoPoint, to: GeoPoint): number {
    return computeGeodesicDistance(from, to);
}

export function computeHeading(from: GeoPoint, to: GeoPoint): number {
    return computeSphericalHeading(from, to);
}

export function interpolate(args: { from: GeoPoint; to: GeoPoint; fraction: number }): GeoPoint {
    return sphericalInterpolate(args);
}
