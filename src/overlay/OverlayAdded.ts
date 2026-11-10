/**
 * Calls each state's `onAdded`, once the overlays it belongs to are on the map.
 *
 * Controllers call this after their add has finished (outside their lock), with
 * only the states that went from "not on the map" to "on the map":
 * - drawn natively: the renderer's `onAdd` returned an overlay for it;
 * - drawn in tiles: the URL template of the tiles holding it was handed to the
 *   map as a raster layer. The tile images themselves may still be loading.
 *
 * An in-place change, or a move between native drawing and tiles while the
 * overlay stays on the map, is not an add. Clearing or destroying the map does
 * not call anything.
 *
 * A callback that throws does not stop the others: the error is reported the
 * way an uncaught error in an event handler is (`reportError` in a browser),
 * which is what a throwing `onClick` amounts to.
 *
 * For controllers (the driver layer), not for apps.
 *
 * @internal
 */
export function notifyOverlaysAdded<S extends { onAdded: ((state: S) => void) | null }>(
    states: readonly S[],
): void {
    for (const state of states) {
        const onAdded = state.onAdded;
        if (onAdded == null) continue;
        try {
            onAdded(state);
        } catch (error) {
            reportCallbackError(error);
        }
    }
}

function reportCallbackError(error: unknown): void {
    const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
    if (typeof report === 'function') report(error);
    else console.error(error);
}
