import type { GeoPointInterface } from "../features";

/** Share of one zIndex step the position tiebreak may use; stays below 0.5. */
const TIEBREAK_SPAN = 0.45;
/** Longitude's share inside the tiebreak: small enough that latitude decides first. */
const LONGITUDE_SPAN = 1e-9;

/**
 * The order a marker is drawn in within the marker band. Larger is in front.
 *
 * - `zIndex ?? 0` decides first: a larger zIndex is always in front, whatever
 *   the position.
 * - Equal zIndex (or both null): further south in front, then further west.
 *
 * The position adds a fraction in [0, 0.5) to the zIndex, so the result stays
 * small. Engines keep their sort keys in float32 or clamp large values, and the
 * old automatic order (`-latitude * 1e6`) put a null-zIndex marker in the
 * southern hemisphere above an explicit zIndex 1 (and on some engines above
 * everything). Every provider's marker renderer feeds its native sort key from
 * this so they all stack the same way.
 * @internal
 */
export function markerDrawOrder(zIndex: number | null | undefined, position: GeoPointInterface): number {
    const latitude = Math.min(90, Math.max(-90, position.latitude));
    const longitude = ((((position.longitude + 180) % 360) + 360) % 360) - 180;
    // 0 at the north pole .. 1 at the south pole; 0 at 180E .. 1 at 180W.
    const south = (90 - latitude) / 180;
    const west = (180 - longitude) / 360;
    return (zIndex ?? 0) + TIEBREAK_SPAN * (south * (1 - LONGITUDE_SPAN) + west * LONGITUDE_SPAN);
}
