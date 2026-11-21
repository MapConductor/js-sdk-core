import { combineHash, longHashCode } from "./hash-utils";

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

// Methods live on the prototype: a closure per method per point made each point
// ~520 bytes, and 720k circle centers alone took ~370 MB of heap.
class GeoPointValue implements GeoPoint {
    latitude: number;
    longitude: number;
    altitude: number | null;

    constructor(latitude: number, longitude: number, altitude: number | null) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.altitude = altitude;
    }

    /**
     * Validates if a GeoPoint has valid coordinates
     */
    isValid(): boolean {
        return (
            this.latitude >= -90 &&
            this.latitude <= 90 &&
            this.longitude >= -180 &&
            this.longitude <= 180
        );
    }

    /**
     * Normalizes a GeoPoint to ensure coordinates are within valid ranges
     */
    normalize(): GeoPoint {
        const normalizedLatitude = Math.max(-90, Math.min(90, this.latitude));
        const normalizedLongitude = ((((this.longitude + 180) % 360) + 360) % 360) - 180;
        return new GeoPointValue(normalizedLatitude, normalizedLongitude, this.altitude ?? 0);
    }

    /**
     * Wraps a GeoPoint around the poles and date line
     */
    wrap(): GeoPoint {
        let wrappedLatitude = this.latitude;
        let wrappedLongitude = this.longitude;

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

        return new GeoPointValue(wrappedLatitude, wrappedLongitude, this.altitude ?? 0);
    }

    /**
     * Checks if two GeoPoints are approximately equal within a tolerance
     */
    equals(other: GeoPoint, tolerance: number = 1e-7): boolean {
        return (
            Math.abs(this.latitude - other.latitude) < tolerance &&
            Math.abs(this.longitude - other.longitude) < tolerance &&
            Math.abs((this.altitude ?? 0) - (other.altitude ?? 0)) < tolerance
        );
    }

    // android-sdk / ios-sdk と一致: 各座標を ×1e7 して truncate した整数の
    // Java Long.hashCode()（切り捨て + 上位ビット fold）を *31 で畳み込む。
    hashCode(): number {
        let result = longHashCode(this.latitude * 1e7);
        result = combineHash(result, longHashCode(this.longitude * 1e7));
        result = combineHash(result, longHashCode((this.altitude ?? 0) * 1e7));
        return result;
    }

    toUrlValue(precision: number = 6): string {
        return [
            truncToPrecision(this.latitude, precision).toFixed(precision),
            truncToPrecision(this.longitude, precision).toFixed(precision),
        ].join(",");
    }
}

/**
 * Creates a GeoPoint from latitude and longitude
 */
export function createGeoPoint(params: {
    latitude: number,
    longitude: number,
    altitude?: number | null,
}): GeoPoint {
    return new GeoPointValue(
        params.latitude,
        params.longitude,
        params.altitude === undefined ? 0 : params.altitude,
    );
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
