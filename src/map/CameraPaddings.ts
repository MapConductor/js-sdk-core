import { AbstractZoomAltitudeConverter } from '../zoom/AbstractZoomAltitudeConverter';
import { computeOffset } from '../spherical/Spherical';
import type { GeoPoint, GeoPointInterface } from '../features/GeoPoint';
import type { MapPaddings } from '../types/MapCamera';
import { toNativeHeading } from './CameraBearing';

/**
 * Viewport size in CSS px.
 * @internal
 */
export interface CameraPaddingsViewport {
    readonly width: number;
    readonly height: number;
}

/**
 * Inputs for emulating `MapCameraPosition.paddings` on an engine that has no
 * native camera padding.
 *
 * `fov` is the provider's own vertical field of view (degrees) for this
 * viewport — `0` for tilt drawn without perspective, `null` when unknown.
 * The core holds no default: each provider passes the value its engine uses.
 * @internal
 */
export interface CameraPaddingsParams {
    zoom: number;
    tilt: number;
    bearing: number;
    paddings: MapPaddings | null;
    fov: number | null;
    viewport: CameraPaddingsViewport;
}

const DEG = Math.PI / 180;

/**
 * Ground offset (meters) from the camera center to the point drawn at the
 * padded area's center: `forward` along the camera heading (negative = toward
 * the viewer), `right` across it.
 */
function paddedCenterGroundOffset(
    latitude: number,
    { zoom, tilt, paddings, fov, viewport }: CameraPaddingsParams,
): { forward: number; right: number } {
    const dx = ((paddings?.left ?? 0) - (paddings?.right ?? 0)) / 2;
    const dy = ((paddings?.top ?? 0) - (paddings?.bottom ?? 0)) / 2;
    if (dx === 0 && dy === 0) return { forward: 0, right: 0 };

    const cosLat = Math.max(Math.cos(Math.max(-85, Math.min(85, latitude)) * DEG), 0.01);
    // meters per CSS px at the center (unified zoom: 256 px tiles).
    const mpp = (AbstractZoomAltitudeConverter.WEB_MERCATOR_INITIAL_MPP_256 * cosLat) / 2 ** zoom;
    const t = Math.max(0, Math.min(89, Math.abs(tilt))) * DEG;

    if (t === 0 || fov == null) {
        // Flat map (or unknown fov): a plain pixel shift.
        return { forward: -dy * mpp, right: dx * mpp };
    }
    if (fov <= 0) {
        // Tilt drawn without perspective: the plane is squashed by cos(tilt) on screen.
        return { forward: (-dy * mpp) / Math.cos(t), right: dx * mpp };
    }

    // Pinhole camera looking at the center, scaled so 1 px at the center is mpp.
    const height = viewport.height > 0 ? viewport.height : 1;
    const f = height / 2 / Math.tan((fov * DEG) / 2);
    const distance = f * mpp;
    const altitude = distance * Math.cos(t);
    // Ray through the pixel (dx, dy) from the screen center; screen-down points
    // toward the viewer and downward.
    const down = f * Math.cos(t) + dy * Math.sin(t);
    if (down <= 0) {
        // The ray misses the ground (above the horizon). Fall back to the flat shift.
        return { forward: -dy * mpp, right: dx * mpp };
    }
    const scale = altitude / down;
    const forwardFromCamera = scale * (f * Math.sin(t) - dy * Math.cos(t));
    const centerFromCamera = distance * Math.sin(t);
    return { forward: forwardFromCamera - centerFromCamera, right: scale * dx };
}

function shift(origin: GeoPointInterface, forward: number, right: number, headingDeg: number): GeoPoint {
    const h = headingDeg * DEG;
    const east = forward * Math.sin(h) + right * Math.cos(h);
    const north = forward * Math.cos(h) - right * Math.sin(h);
    const distance = Math.hypot(east, north);
    return computeOffset({
        origin: origin as GeoPoint,
        distance,
        heading: distance === 0 ? 0 : Math.atan2(east, north) / DEG,
    });
}

/**
 * The camera center to send to an engine without native padding so that
 * `target` is drawn at the center of the area left after `paddings`.
 *
 * Exact for a flat map and for tilt drawn without perspective (`fov` 0);
 * under perspective it is exact for the pinhole camera described by `fov`.
 * @internal
 */
export function paddedCameraCenter(target: GeoPointInterface, params: CameraPaddingsParams): GeoPoint {
    const { forward, right } = paddedCenterGroundOffset(target.latitude, params);
    // The target sits at (forward, right) from the center, so the center is the opposite way.
    return shift(target, -forward, -right, toNativeHeading(params.bearing));
}

/**
 * The inverse of {@link paddedCameraCenter}: the point drawn at the padded
 * area's center, given the engine's camera center.
 * @internal
 */
export function paddedCameraTarget(center: GeoPointInterface, params: CameraPaddingsParams): GeoPoint {
    const { forward, right } = paddedCenterGroundOffset(center.latitude, params);
    return shift(center, forward, right, toNativeHeading(params.bearing));
}
