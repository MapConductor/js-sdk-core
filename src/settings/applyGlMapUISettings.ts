import { MapUISettingsDiagnostics, type MapUISettings } from './MapUISettings';

/**
 * The gesture handlers MapLibre GL JS exposes on its map object.
 *
 * Mapbox GL JS, the MapTiler SDK and the TomTom Maps SDK are all MapLibre/Mapbox
 * GL forks and expose the same handlers, so the four providers share one
 * implementation. Typed structurally rather than against any one SDK's types so
 * that this stays in the core package.
 */
export interface GlGestureHandler {
    enable(): void;
    disable(): void;
}

export interface GlTouchZoomRotateHandler extends GlGestureHandler {
    enableRotation(): void;
    disableRotation(): void;
}

export interface GlGestureHandlers {
    dragPan: GlGestureHandler;
    scrollZoom: GlGestureHandler;
    doubleClickZoom: GlGestureHandler;
    touchZoomRotate: GlTouchZoomRotateHandler;
    dragRotate: GlGestureHandler;
    touchPitch: GlGestureHandler;
}

function toggle(handler: GlGestureHandler | undefined, enabled: boolean): void {
    if (!handler) return;
    if (enabled) handler.enable();
    else handler.disable();
}

/**
 * Applies {@link MapUISettings} to a MapLibre-GL-style map.
 *
 * Two handlers cover more than one gesture, and neither can be split apart, so
 * the flags cannot always be honoured independently:
 *
 * - `touchZoomRotate` drives both pinch-zoom and pinch-rotate. It has to stay on
 *   for either, so disabling zoom while rotation is still wanted leaves
 *   pinch-zoom working.
 * - `dragRotate` rotates *and* pitches on a right-button drag, so a map that
 *   allows rotation also allows tilting with the mouse.
 *
 * Each case logs a one-time warning naming the gesture that stays available.
 */
export function applyGlMapUISettings(
    map: Partial<GlGestureHandlers> | null | undefined,
    settings: MapUISettings,
    provider: string,
): void {
    if (!map) return;

    toggle(map.dragPan, settings.scrollGesture);
    toggle(map.scrollZoom, settings.zoomGesture);
    toggle(map.doubleClickZoom, settings.zoomGesture);

    // One handler, two gestures: keep it alive while either is wanted, then use
    // its own rotation sub-switch to drop rotation alone.
    toggle(map.touchZoomRotate, settings.zoomGesture || settings.rotateGesture);
    if (settings.rotateGesture) map.touchZoomRotate?.enableRotation();
    else map.touchZoomRotate?.disableRotation();

    toggle(map.dragRotate, settings.rotateGesture);
    toggle(map.touchPitch, settings.tiltGesture);

    if (!settings.zoomGesture && settings.rotateGesture) {
        MapUISettingsDiagnostics.warnIfRequested(
            false,
            'zoom',
            provider,
            'pinch zoom and pinch rotation share one handler, so pinch zoom stays available while rotation is enabled',
        );
    }
    if (settings.rotateGesture && !settings.tiltGesture) {
        MapUISettingsDiagnostics.warnIfRequested(
            false,
            'tilt',
            provider,
            'a rotate drag also pitches the map, so tilting stays available while rotation is enabled',
        );
    }
}
