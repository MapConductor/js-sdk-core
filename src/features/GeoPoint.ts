import { combineHash, toInt } from "./hash-utils";

export interface GeoPointInterface {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    wrap?(): GeoPointInterface;
}

/**
 * Represents a geographic coordinate point with latitude, longitude, and optional altitude.
 */
export interface GeoPoint extends GeoPointInterface {
    /** Latitude in degrees (-90 to 90) */
    latitude: number;
    /** Longitude in degrees (-180 to 180) */
    longitude: number;
    /** Altitude in meters (optional) */
    altitude?: number | null;

    isValid(): boolean;
    normalize(): GeoPoint;
    wrap(): GeoPoint;
    equals(other: GeoPoint): boolean;
    hashCode(): number;
    toUrlValue(precision: number): string;
}

const truncToPrecision = (value: number, precision: number): number => {
    const factor = 10 ** precision;
    return Math.trunc(value * factor) / factor;
};

export function fromLatLng({
    latitude,
    longitude,
    altitude,
}: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
}): GeoPoint {
    return createGeoPoint({ latitude, longitude, altitude });
}

export const fromLatLong = fromLatLng;

export function fromLngLat({
    longitude,
    latitude,
    altitude,
}: {
    longitude: number;
    latitude: number;
    altitude?: number | null;
}): GeoPoint {
    return createGeoPoint({ latitude, longitude, altitude });
}

export const fromLongLat = fromLngLat;

export function fromGeoPoint(position: GeoPointInterface): GeoPoint {
    if (isGeoPoint(position)) {
        return position;
    }
    return createGeoPoint({
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude ?? 0,
    });
}

const isGeoPoint = (position: GeoPointInterface): position is GeoPoint => {
    return (
        typeof (position as GeoPoint).isValid === "function" &&
        typeof (position as GeoPoint).normalize === "function" &&
        typeof (position as GeoPoint).hashCode === "function" &&
        typeof (position as GeoPoint).toUrlValue === "function"
    );
};

/**
 * Creates a GeoPoint from latitude and longitude
 */
export function createGeoPoint(params: {
    latitude: number,
    longitude: number,
    altitude?: number | null,
}): GeoPoint {
    const altitude = params.altitude === undefined ? 0 : params.altitude;

    /**
     * Validates if a GeoPoint has valid coordinates
     */
    const isValid = () => (
        params.latitude >= -90 &&
        params.latitude <= 90 &&
        params.longitude >= -180 &&
        params.longitude <= 180
    );

    /**
     * Normalizes a GeoPoint to ensure coordinates are within valid ranges
     */
    const normalize = (): GeoPoint => {
        const normalizedLatitude = Math.max(-90, Math.min(90, params.latitude));
        const normalizedLongitude = ((((params.longitude + 180) % 360) + 360) % 360) - 180;
        return createGeoPoint({
            latitude: normalizedLatitude,
            longitude :normalizedLongitude,
            altitude: altitude ?? 0,
        });
    };

    /**
     * Wraps a GeoPoint around the poles and date line
     */
    const wrap = (): GeoPoint => {
        let wrappedLatitude = params.latitude;
        let wrappedLongitude = params.longitude;

        // Handle latitude overflow/underflow
        if (wrappedLatitude > 90) {
            const excess = wrappedLatitude - 90;
            wrappedLatitude = -90 + excess;
            wrappedLongitude += 180;
        } else if (wrappedLatitude < -90) {
            const deficit = -90 - wrappedLatitude;
            wrappedLatitude = 90 - deficit;
            wrappedLongitude += 180;
        }

        // Normalize longitude to [-180, 180] range
        wrappedLongitude = ((((wrappedLongitude + 180) % 360) + 360) % 360) - 180;

        return createGeoPoint({
            latitude: wrappedLatitude,
            longitude: wrappedLongitude,
            altitude: altitude ?? 0,
        });
    };

    /**
     * Checks if two GeoPoints are approximately equal within a tolerance
     */
    const equals = (other: GeoPoint, tolerance: number = 1e-7): boolean => {
        return (
            Math.abs(params.latitude - other.latitude) < tolerance &&
            Math.abs(params.longitude - other.longitude) < tolerance &&
            Math.abs((altitude ?? 0) - (other.altitude ?? 0)) < tolerance
        );
    }

    const hashCode = (): number => {
        let result = toInt(Number((params.latitude * 1e7).toFixed(0)));
        result = combineHash(result, toInt(Number((params.longitude * 1e7).toFixed(0))));
        result = combineHash(result, toInt(Number(((altitude ?? 0) * 1e7).toFixed(0))));
        return result;
    };

    const toUrlValue = (precision: number = 6): string => {
        return [
            truncToPrecision(params.latitude, precision).toFixed(precision),
            truncToPrecision(params.longitude, precision).toFixed(precision),
        ].join(",");
    };

    return {
        latitude: params.latitude,
        longitude: params.longitude,
        altitude,
        equals,
        hashCode,
        isValid,
        normalize,
        toUrlValue,
        wrap,
    };
}

export namespace GeoPoint {
    export const fromLatLng = (
        latitude: number,
        longitude: number,
        altitude?: number | null,
    ) => createGeoPoint({ latitude, longitude, altitude });

    export const fromLatLong = fromLatLng;

    export const fromLngLat = (
        longitude: number,
        latitude: number,
        altitude?: number | null,
    ) => createGeoPoint({ latitude, longitude, altitude });

    export const fromLongLat = fromLngLat;

    export const from = (position: GeoPointInterface) => fromGeoPoint(position);
}
