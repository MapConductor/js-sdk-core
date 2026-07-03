import { createGeoPoint } from "../features/GeoPoint";
import { createGeoRectBounds, GeoRectBounds } from "../features/GeoRectBounds";

export function expandBounds(bounds: GeoRectBounds, margin: number): GeoRectBounds {
    if (bounds.isEmpty()) return bounds;

    const span = bounds.toSpan();
    if (span == null) return bounds;

    const center = bounds.center;
    if (center == null) return bounds;

    const latMargin = span.latitude * margin / 2.0;
    const lngMargin = span.longitude * margin / 2.0;

    const expandedBounds = createGeoRectBounds({
        southWest: null,
        northEast: null,
    });

    expandedBounds.extend(createGeoPoint({
        latitude: center.latitude - span.latitude / 2.0 - latMargin,
        longitude: center.longitude - span.longitude / 2.0 - lngMargin,
    }));
    expandedBounds.extend(createGeoPoint({
        latitude: center.latitude + span.latitude / 2.0 + latMargin,
        longitude: center.longitude + span.longitude / 2.0 + lngMargin,
    }));

    return expandedBounds;
}
