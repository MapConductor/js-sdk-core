// The straight-line ("planar") line model: edges are straight lines in lat/lng
// space (equirectangular), not great circles or geodesics. Mirrors the path-op
// surface of the earth-model calculators so callers can pick a model by
// namespace — e.g. `geodesic ? WGS84Geodesic : Planar`.

export { planarInterpolate as interpolate } from "./_PlanarInterpolate";
export { densifyAlongStraightLine as createInterpolatePoints } from "./CreateLinearInterpolatePoints";
export { linearPointOnLineOrNull as pointOnLineOrNull } from "./PointOnLinearLineOrNull";
