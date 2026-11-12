/** x / y of a projected point: the unit of {@link MapCoordinateSystem}. */
export enum ProjectedUnit {
    Meters = "meters",
    Degrees = "degrees",
    /** Feet and the like, or a unit the engine defines itself. */
    Other = "other",
}

/**
 * The coordinate system the map engine lays the map out in. **Not screen
 * coordinates.**
 *
 * Tells which coordinate system the point returned by
 * `MapViewHolder.toProjectedPoint` is in.
 *
 * - `code` is an identifier such as `"EPSG:3857"`, or null for a projection the
 *   engine defines itself without an EPSG (or similar) number.
 * - `unit` is the unit of x / y.
 *
 * Engines that only have Mercator, and engines showing a globe, use
 * {@link MapCoordinateSystem.WebMercator} (EPSG:3857 meters).
 */
export interface MapCoordinateSystem {
    readonly code: string | null;
    readonly unit: ProjectedUnit;
}

export const MapCoordinateSystem = Object.freeze({
    /** EPSG:3857. x / y are meters. */
    WebMercator: Object.freeze({ code: "EPSG:3857", unit: ProjectedUnit.Meters }) as MapCoordinateSystem,
    /** EPSG:4326. x is longitude and y is latitude, in degrees. */
    WGS84: Object.freeze({ code: "EPSG:4326", unit: ProjectedUnit.Degrees }) as MapCoordinateSystem,
});
