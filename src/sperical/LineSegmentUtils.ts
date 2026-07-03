import { GeoPoint } from "../features/GeoPoint";
import { createGeoRectBounds, GeoRectBounds } from "../features/GeoRectBounds";
import { sphericalInterpolate } from "./Spherical";

export function createSegmentBounds({
    point1,
    point2,
    geodesic = false,
}: {
    point1: GeoPoint;
    point2: GeoPoint;
    geodesic?: boolean;
}): GeoRectBounds {
    const bounds = createGeoRectBounds({
        southWest: null,
        northEast: null,
    });

    if (!geodesic) {
        bounds.extend(point1);
        bounds.extend(point2);
        return bounds;
    }

    const samples = 32;
    bounds.extend(point1);
    for (let s = 1; s <= samples; s += 1) {
        const f = s / samples;
        const sp = sphericalInterpolate({ from: point1, to: point2, fraction: f });
        bounds.extend(sp);
    }
    return bounds;
}

export function segmentIntersectsRegion({
    start,
    end,
    region,
    geodesic = false,
}: {
    start: GeoPoint;
    end: GeoPoint;
    region: GeoRectBounds;
    geodesic?: boolean;
}): boolean {
    if (region.isEmpty()) return false;

    const segmentBounds = createSegmentBounds({ point1: start, point2: end, geodesic });
    return segmentBounds.intersects(region);
}
