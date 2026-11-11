import type { GeoPointInterface } from "../features";

/** Share of one zIndex step the position tiebreak may use; stays below 0.5. */
const TIEBREAK_SPAN = 0.45;
/** The horizontal share inside the tiebreak: small enough that the vertical decides first. */
const HORIZONTAL_SPAN = 1e-9;
/** Web Mercator's latitude limit; beyond it the world y runs off to infinity. */
const MAX_MERCATOR_LATITUDE = 85.05112878;

/**
 * The order a marker is drawn in within the marker band. Larger is in front.
 *
 * - `zIndex ?? 0` decides first: a larger zIndex is always in front, whatever
 *   the position.
 * - Equal zIndex (or both null): the one lower on screen is in front, then the
 *   one further left. This is what Google Maps JS does (measured with both
 *   Marker and AdvancedMarkerElement), except that on the exact same screen row
 *   Google falls back to add order and this keeps the left one in front, so
 *   the order never depends on the order markers were added.
 *
 * "On screen" means after the map is rotated to `headingDegrees`: the compass
 * direction at the top of the screen, clockwise from north, which is what
 * heading-style SDKs report. MapConductor's `bearing` turns the other way, so
 * pass `toNativeHeading(bearing)`. With the default heading 0 the order is
 * simply further south, then further west. Tilt doesn't change the order, nor
 * do pan or zoom, so callers only need to recompute when the heading changes.
 * `originLongitude` should be near the camera center so a pair of markers
 * either side of the antimeridian is measured the short way round.
 *
 * The position adds a fraction in [0, 0.5) to the zIndex, so the result stays
 * small. Engines keep their sort keys in float32 or clamp large values, and the
 * old automatic order (`-latitude * 1e6`) put a null-zIndex marker in the
 * southern hemisphere above an explicit zIndex 1 (and on some engines above
 * everything). Every provider's marker renderer feeds its native sort key from
 * this so they all stack the same way.
 * @internal
 */
export function markerDrawOrder(
    zIndex: number | null | undefined,
    position: GeoPointInterface,
    headingDegrees = 0,
    originLongitude = 0,
): number {
    const latitude = Math.min(MAX_MERCATOR_LATITUDE, Math.max(-MAX_MERCATOR_LATITUDE, position.latitude));
    const sinLatitude = Math.sin((latitude * Math.PI) / 180);
    // Web Mercator world coordinates in [0, 1]: x eastward from 180W, y southward from the top.
    const worldX = (position.longitude + 180) / 360;
    const worldY = 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);
    const dx = wrapHalf(worldX - (originLongitude + 180) / 360);
    const dy = worldY - 0.5;
    const theta = (headingDegrees * Math.PI) / 180;
    const down = -dx * Math.sin(theta) + dy * Math.cos(theta);
    const right = dx * Math.cos(theta) + dy * Math.sin(theta);
    // |dx|, |dy| <= 0.5, so both rotated values stay within ±1/√2.
    const down01 = 0.5 + down / Math.SQRT2;
    const left01 = 0.5 - right / Math.SQRT2;
    return (zIndex ?? 0) + TIEBREAK_SPAN * (down01 * (1 - HORIZONTAL_SPAN) + left01 * HORIZONTAL_SPAN);
}

/** Wraps a world-x difference into [-0.5, 0.5). */
function wrapHalf(value: number): number {
    return ((((value + 0.5) % 1) + 1) % 1) - 0.5;
}

/** Heading change, in degrees, below which the stacking is left as it is. */
const HEADING_STEP_DEGREES = 0.5;

/**
 * Remembers the heading (and a nearby origin longitude) the markers were last
 * ordered for, so a renderer re-sorts only when rotating the map changes the
 * order. Pan, zoom and tilt never change it, except that panning far enough
 * moves the origin used to measure across the antimeridian.
 * @internal
 */
export class MarkerDrawOrderView {
    heading = 0;
    originLongitude = 0;

    /**
     * Takes the camera's heading (see {@link markerDrawOrder}) and center longitude. Returns true when the
     * markers need their order recomputed.
     */
    update(headingDegrees: number | null | undefined, centerLongitude: number | null | undefined): boolean {
        const heading = normalizeDegrees(headingDegrees ?? 0);
        const center = Number.isFinite(centerLongitude) ? (centerLongitude as number) : this.originLongitude;
        const turned = angularDistance(heading, this.heading) >= HEADING_STEP_DEGREES;
        const panned = angularDistance(center, this.originLongitude) > 90;
        if (!turned && !panned) return false;
        if (turned) this.heading = heading;
        this.originLongitude = center;
        return true;
    }

    order(zIndex: number | null | undefined, position: GeoPointInterface): number {
        return markerDrawOrder(zIndex, position, this.heading, this.originLongitude);
    }
}

function normalizeDegrees(value: number): number {
    return ((value % 360) + 360) % 360;
}

function angularDistance(a: number, b: number): number {
    const d = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
    return Math.min(d, 360 - d);
}
