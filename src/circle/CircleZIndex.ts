import type { GeoPoint } from "../features/GeoPoint";
import type { CircleState } from "./CircleState";

/**
 * The zIndex a circle without one is drawn and hit-tested with: further south
 * (then further west) on top. The circle renderers of every provider use it,
 * and so do the tiles, so both stack the same way.
 * @internal
 */
export function calculateCircleZIndex(center: GeoPoint): number {
    return ((-center.latitude * 1_000_000 - center.longitude) | 0);
}

/** `state.zIndex`, or the automatic one when it is null. @internal */
export function effectiveCircleZIndex(state: CircleState): number {
    return state.zIndex ?? calculateCircleZIndex(state.center);
}
