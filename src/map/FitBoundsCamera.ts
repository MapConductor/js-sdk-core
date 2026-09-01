import { GeoPoint, createGeoPoint } from "../features/GeoPoint";
import type { GeoRectBounds } from "../features/GeoRectBounds";
import { WebMercator, WEB_MERCATOR_MAX_EXTENT_METERS } from "../projection/WebMercator";
import { toNativeHeading } from "./CameraBearing";

/**
 * Unified, provider-independent "fit bounds" camera computation.
 *
 * Projects the four bounds corners into Web Mercator, rotates them into the
 * (bearing-aligned) screen frame, and finds the unified zoom at which that
 * rectangle fits inside the viewport minus `padding` on every side. The result
 * is a top-down camera (center + unified zoom); the provider's
 * zoomAltitudeConverter turns the unified zoom into its native zoom/altitude.
 *
 * This is orthographic, so it is exact for `tilt = 0` and handles `bearing`
 * (rotation). It does NOT model perspective under `tilt` — providers whose
 * native SDK exposes a pitch-aware fit should use that for tilted cameras and
 * fall back to this for the top-down case.
 */

const WORLD_MERCATOR_METERS = 2 * WEB_MERCATOR_MAX_EXTENT_METERS;
const DEFAULT_TILE_SIZE = 256;
const MIN_ZOOM = 0;
const MAX_ZOOM = 24;

export interface FitBoundsCameraResult {
    center: GeoPoint;
    /** Unified (Google-style, 256px tile) zoom level. */
    zoom: number;
}

function normalizeLng(lng: number): number {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function computeFitBoundsCameraPosition({
    bounds,
    viewportWidthPx,
    viewportHeightPx,
    padding = 0,
    bearing = 0,
    tileSize = DEFAULT_TILE_SIZE,
}: {
    bounds: GeoRectBounds;
    viewportWidthPx: number;
    viewportHeightPx: number;
    /** Inset in pixels applied on every side. */
    padding?: number;
    /** Map bearing in degrees; the fit accounts for a rotated viewport. */
    bearing?: number;
    tileSize?: number;
}): FitBoundsCameraResult | null {
    const sw = bounds.southWest;
    const ne = bounds.northEast;
    if (!sw || !ne || viewportWidthPx <= 0 || viewportHeightPx <= 0) return null;

    const swLng = sw.longitude;
    let neLng = ne.longitude;
    if (neLng < swLng) neLng += 360; // unwrap across the antimeridian

    // All four corners, projected to Web Mercator meters.
    const corners = [
        WebMercator.project(createGeoPoint({ latitude: sw.latitude, longitude: swLng })),
        WebMercator.project(createGeoPoint({ latitude: sw.latitude, longitude: neLng })),
        WebMercator.project(createGeoPoint({ latitude: ne.latitude, longitude: swLng })),
        WebMercator.project(createGeoPoint({ latitude: ne.latitude, longitude: neLng })),
    ];
    const centerX = (corners[0].x + corners[3].x) / 2;
    const centerY = (corners[0].y + corners[3].y) / 2;

    // Rotate the corners about the center so the direction that is *up* on
    // screen lands on +y → screen-aligned extent. Screen-up is the camera
    // heading, which is the opposite of MapConductor's map-rotation bearing.
    const rad = (-toNativeHeading(bearing) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
        const dx = c.x - centerX;
        const dy = c.y - centerY;
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;

    const effW = Math.max(1, viewportWidthPx - 2 * padding);
    const effH = Math.max(1, viewportHeightPx - 2 * padding);

    // At zoom z the whole mercator world (WORLD_MERCATOR_METERS wide) is
    // tileSize·2^z px. Fit each axis: span·tileSize·2^z / WORLD ≤ effPx.
    const zoomForAxis = (span: number, effPx: number): number =>
        span <= 0 ? MAX_ZOOM : Math.log2((effPx * WORLD_MERCATOR_METERS) / (span * tileSize));

    const zoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min(zoomForAxis(spanX, effW), zoomForAxis(spanY, effH))),
    );

    const center = WebMercator.unproject({ x: centerX, y: centerY });
    return {
        center: createGeoPoint({
            latitude: center.latitude,
            longitude: normalizeLng(center.longitude),
            altitude: null,
        }),
        zoom,
    };
}
