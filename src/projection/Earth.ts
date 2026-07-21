// WGS84 ellipsoid parameters. https://epsg.org/ellipsoid_7030/WGS-84.html
const RADIUS_METERS = 6378137.0;
const FLATTENING = 1.0 / 298.257223563;

export const Earth = Object.freeze({
    /** WGS84 semi-major axis (equatorial radius) in meters. */
    RADIUS_METERS,

    /** Equatorial circumference (2πa) in meters. */
    CIRCUMFERENCE_METERS: 2 * Math.PI * RADIUS_METERS,

    /** WGS84 flattening f = 1 / 298.257223563. */
    FLATTENING,

    /** WGS84 semi-minor axis (polar radius) b = a(1 - f) in meters. */
    SEMI_MINOR_AXIS_METERS: RADIUS_METERS * (1.0 - FLATTENING),

    /** WGS84 first eccentricity squared e² = f(2 - f). */
    ECCENTRICITY_SQUARED: FLATTENING * (2.0 - FLATTENING),
})
