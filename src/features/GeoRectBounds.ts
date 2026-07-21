import { createGeoPoint, fromGeoPoint, GeoPoint, GeoPointInterface } from './GeoPoint';

/**
 * Represents a rectangular geographic boundary
 */
export interface GeoRectBounds {
    /** Southwest corner of the boundary */
    southWest: GeoPoint | null;
    /** Northeast corner of the boundary */
    northEast: GeoPoint | null;
    /** Extends bounds to include a point */
    center: GeoPoint | null;
    equals: (other: GeoRectBounds | null) => boolean;
    extend(point: GeoPointInterface): void;
    isEmpty(): boolean;
    intersects(other: GeoRectBounds): boolean;
    contains(point: GeoPointInterface): boolean;
    toSpan(): GeoPoint | null;
    toString(): string;
    toUrlValue(precision: number): string;
    union(other: GeoRectBounds | null): GeoRectBounds;
    expandedByDegrees(latPad: number, lonPad: number): GeoRectBounds;
}

/**
 * Creates a GeoRectBounds from two corner points
 */
export function createGeoRectBounds(params: {
    southWest?: GeoPoint | null,
    northEast?: GeoPoint | null,
} = {}): GeoRectBounds {
    let _southWest: GeoPoint | null = params.southWest ?? null;
    let _northEast: GeoPoint | null = params.northEast ?? null;
    let _center: GeoPoint | null = null;

    const updateCenter = (): void => {
        if (isEmpty()) {
            return;
        }

        const sw = _southWest!.wrap()
        const ne = _northEast!.wrap()

        const centerLat = (sw.latitude + ne.latitude) / 2.0

        const lng1 = sw.longitude
        const lng2 = ne.longitude
        const centerLng = (() => {
            if (lng1 <= lng2) {
                return ((lng1 + lng2) / 2.0);
            } else {
                const centerLongitude = (lng1 + (lng2 + 360)) / 2.0
                if (centerLongitude > 180) {
                    return centerLongitude - 360;
                } else {
                    return centerLongitude;
                }
            }
        })();

        _center = createGeoPoint({
            latitude: centerLat,
            longitude: centerLng,
        });
    };

    const extend = (point: GeoPointInterface): void => {
        const position = fromGeoPoint(point).wrap();

        switch(true) {
            // 初期化
            case _southWest == null && _northEast == null: {
                _southWest = position;
                _northEast = position;
                break;
            }

            // southWest のみ存在
            case _southWest != null && _northEast == null: {
                const sw = _southWest!;
                const south = Math.min(sw.latitude, position.latitude);
                const north = Math.max(sw.latitude, position.latitude);
                const west = Math.min(sw.longitude, position.longitude);
                const east = Math.max(sw.longitude, position.longitude);

                _southWest = createGeoPoint({
                    latitude: south,
                    longitude: west,
                });
                _northEast = createGeoPoint({
                    latitude: north,
                    longitude: east,
                });
                break;
            }

            // northEast のみ存在
            case _southWest == null && _northEast != null: {
                const ne = _northEast!
                const south = Math.min(ne.latitude, position.latitude);
                const north = Math.max(ne.latitude, position.latitude);
                const west = Math.min(ne.longitude, position.longitude);
                const east = Math.max(ne.longitude, position.longitude);

                _southWest = createGeoPoint({
                    latitude: south,
                    longitude: west,
                });
                _northEast = createGeoPoint({
                    latitude: north,
                    longitude: east,
                });
                break;
            }

            default: {
                const south = Math.min(position.latitude, _southWest!.latitude);
                const north = Math.max(position.latitude, _northEast!.latitude);

                let west = _southWest!.longitude;
                let east = _northEast!.longitude;

                if (west > 0 && east < 0) {
                    if (position.longitude > 0) {
                        west = Math.min(position.longitude, west);
                    } else {
                        east = Math.max(position.longitude, east);
                    }
                } else {
                    west = Math.min(position.longitude, _southWest!.longitude);
                    east = Math.max(position.longitude, _northEast!.longitude);
                }

                // Ensure longitudinal span uses the minimal arc (handle antimeridian)
                const span = ((east - west + 360) % 360);
                if (span > 180.0) {
                    // Flip to crossing-dateline representation so that west > east
                    const newWest = east;
                    const newEast = west;
                    west = newWest
                    east = newEast
                }

                _southWest = createGeoPoint({
                    latitude: south,
                    longitude: west,
                });
                _northEast = createGeoPoint({
                    latitude: north,
                    longitude: east,
                });
            }
        }
        updateCenter();
    };

    const isEmpty = (): boolean => {
        return _southWest == null || _northEast == null;
    }

    const containsLongitude = (
        lon: number,
        west: number,
        east: number,
    ): boolean => { 
        if (west <= east) {
            return west <= lon && lon <= east;
        } else {
            return lon >= west || lon <= east
        }
    };

    const contains = (point: GeoPointInterface): boolean => {
        if (isEmpty()) return false

        const wrappedPoint = fromGeoPoint(point).wrap();
        const sw = _southWest!.wrap()
        const ne = _northEast!.wrap()

        const withinLat = sw.latitude <= wrappedPoint.latitude && wrappedPoint.latitude <= ne.latitude;
        const withinLng = containsLongitude(wrappedPoint.longitude, sw.longitude, ne.longitude)

        return withinLat && withinLng
    };

    const clone = (source: GeoRectBounds): GeoRectBounds => {
        return createGeoRectBounds({
            southWest: source.southWest,
            northEast: source.northEast,
        });
    };

    const union = (other: GeoRectBounds | null): GeoRectBounds => {
        if (!other || other.isEmpty()) {
            return clone(bounds);
        }
        if (isEmpty()) {
            return clone(other);
        }

        const newBounds = clone(bounds);
        newBounds.extend(other.southWest!.wrap())
        newBounds.extend(other.northEast!.wrap())
        return newBounds;
    }

    const expandedByDegrees = (latPad: number, lonPad: number): GeoRectBounds => {
        if (isEmpty()) {
            return createGeoRectBounds();
        }

        const sw = _southWest!.wrap();
        const ne = _northEast!.wrap();
        const south = Math.max(-90, Math.min(90, sw.latitude - latPad));
        const north = Math.max(-90, Math.min(90, ne.latitude + latPad));

        let west = normalizeLongitude(sw.longitude - lonPad);
        let east = normalizeLongitude(ne.longitude + lonPad);

        const span = ((east - west + 360) % 360);
        if (span > 180.0) {
            const newWest = east;
            const newEast = west;
            west = newWest;
            east = newEast;
        }

        return createGeoRectBounds({
            southWest: createGeoPoint({ latitude: south, longitude: west }),
            northEast: createGeoPoint({ latitude: north, longitude: east }),
        });
    };

    const toSpan = (): GeoPoint | null => {
        if (isEmpty()) return null;

        const sw = _southWest!.wrap()
        const ne = _northEast!.wrap()

        const latSpan = ne.latitude - sw.latitude
        const lngSpan = ((it : number) => {
            return (it != 0.0) ? it : 360.0;
        })((ne.longitude - sw.longitude + 360) % 360);

        return createGeoPoint({
            latitude: latSpan,
            longitude: lngSpan,
        });
    };

    const toUrlValue = (precision: number = 6): string => {
        if (isEmpty()) return "1.0,180.0,-1.0,-180.0";

        const sw = _southWest!.wrap();
        const ne = _northEast!.wrap();

        return [
            sw.latitude.toFixed(precision),
            sw.longitude.toFixed(precision),
            ne.latitude.toFixed(precision),
            ne.longitude.toFixed(precision),
        ].join(",")
    };

    const normalizeLongitude = (lon: number): number => {
        return (((lon + 180.0) % 360.0 + 360.0) % 360.0) - 180.0;
    }

    // Longitude overlap: represent each bounds as up to two intervals to handle antimeridian
    const lonIntervals = (
        west: number,
        east: number,
    ): number[][] => {
        if (west <= east) {
            const span = east - west
            if (span <= 180.0) {
                return [[west, east]]
            } else {
                // Large span means minimal interval crosses the dateline
                return [
                    [west, 180.0],
                    [-180.0, east],
                ]
            }
        } else {
            // Crosses the antimeridian: [west, 180] U [-180, east]
            return [
                [west, 180.0],
                [-180.0, east],
            ];
        }
    }


    const intersects = (other: GeoRectBounds): boolean => {
        if (isEmpty() || other.isEmpty()) {
            return false;
        }

        const sw1 = _southWest!.wrap()
        const ne1 = _northEast!.wrap()
        const sw2 = other.southWest!.wrap()
        const ne2 = other.northEast!.wrap()

        // Latitude overlap (simple interval intersection)
        const epsilon = 1e-9
        const latOverlap =
            ne1.latitude >= sw2.latitude - epsilon &&
                ne2.latitude >= sw1.latitude - epsilon
        if (!latOverlap) {
            return false
        }

        // Normalize longitudes to [-180, 180] for robustness
        const w1 = normalizeLongitude(sw1.longitude)
        const e1 = normalizeLongitude(ne1.longitude)
        const w2 = normalizeLongitude(sw2.longitude)
        const e2 = normalizeLongitude(ne2.longitude)

        
        const intervals1 = lonIntervals(w1, e1)
        const intervals2 = lonIntervals(w2, e2)

        // Check if any pair of intervals overlaps (inclusive)
        for (const [aStart, aEnd] of intervals1) {
            for (const [bStart, bEnd] of intervals2) {
                const overlap = aStart <= bEnd && aEnd >= bStart;
                if (overlap) return true;
            }
        }
        return false;
    }
    
    const toString = (): string => {
        if (isEmpty()) {
            return "((1, 180), (-1, -180))";
        } else {
            const sw = _southWest!;
            const ne = _northEast!;
            return `((${sw.latitude}, ${sw.longitude}), (${ne!.latitude}, ${ne!.longitude}))`;
        }
    }

    const samePoint = (a: GeoPoint | null | undefined, b: GeoPoint | null | undefined): boolean => {
        if (!a && !b) return true;
        if (!a || !b) return false;
        const tolerance = 1e-2;
        return (
            Math.abs(a.latitude - b.latitude) < tolerance &&
            Math.abs(a.longitude - b.longitude) < tolerance &&
            Math.abs((a.altitude ?? 0) - (b.altitude ?? 0)) < tolerance
        );
    };

    const equals = (other: GeoRectBounds | null): boolean => {
        if (!other) return false;
        return samePoint(_southWest?.wrap(), other.southWest?.wrap()) &&
                samePoint(_northEast?.wrap(), other.northEast?.wrap());
    };

    if (!isEmpty()) {
        updateCenter();
    }

    const bounds: GeoRectBounds = {
        get southWest() { return _southWest; },
        get northEast() { return _northEast; },
        get center() { return _center; },
        contains,
        extend,
        equals,
        expandedByDegrees,
        isEmpty,
        intersects,
        toSpan,
        toString,
        toUrlValue,
        union,
    };

    return bounds;
}
