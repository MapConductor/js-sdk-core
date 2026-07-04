import { MarkerAnimation } from "./MarkerAnimation";
import { BitmapIcon } from "./MarkerOverlayRenderer";
import { MarkerState } from "./MarkerState";

/**
 * A single marker animation request handed off to a screen-space overlay
 * layer instead of being played by mutating the provider's native marker.
 *
 * Mirrors Android's `MarkerAnimationOverlayEntry` (compose/marker):
 * the overlay animates `bitmapIcon` in screen space above the map view and
 * below InfoBubbles, re-projecting `state.position` every frame so the
 * animation tracks camera movement/tilt/rotation correctly.
 */
export interface MarkerAnimationOverlayEntry {
    id: string;
    state: MarkerState;
    bitmapIcon: BitmapIcon;
    animation: MarkerAnimation;
    durationMillis: number;
    onFinished: () => void;
}

/**
 * Implemented by the view layer (e.g. a React component) that owns the
 * screen-space canvas/DOM overlay. Renderers call `host(entry)` to start
 * an animation instead of interpolating geographic coordinates themselves.
 */
export type MarkerAnimationOverlayHost = (entry: MarkerAnimationOverlayEntry) => void;

const androidBounce = (time: number): number => time * time * 8.0;

/**
 * Ports Android's `BounceInterpolator` easing curve so overlay-driven and
 * legacy geo-interpolated bounce animations look identical.
 */
export const bounceInterpolation = (time: number): number => {
    const t = time * 1.1226;
    if (t < 0.3535) return androidBounce(t);
    if (t < 0.7408) return androidBounce(t - 0.54719) + 0.7;
    if (t < 0.9644) return androidBounce(t - 0.8526) + 0.9;
    return androidBounce(t - 1.0435) + 0.95;
};
