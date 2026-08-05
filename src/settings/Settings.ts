/**
 * Marker icon sizes shared by the bundled icon renderers.
 *
 * Mirrors `com.mapconductor.settings.MarkerIconSize` (Android) and `MarkerIconSize`
 * in `MapConductorCore` (iOS).
 */
export const MarkerIconSize = Object.freeze({
    Small: 32,
    Regular: 48,
    Large: 60,
});

/**
 * SDK-wide tuning constants.
 *
 * Mirrors `com.mapconductor.settings.Settings` (Android) and `Settings` in
 * `MapConductorCore` (iOS); member names and values are kept in sync across the
 * three platforms so that behaviour is portable.
 *
 * Lengths are CSS pixels here, `dp` on Android and points on iOS. Durations are in
 * milliseconds on all three platforms.
 */
export const Settings = Object.freeze({
    Default : Object.freeze({
        // Deliberately larger than the native platforms' 14. Native hit-testing scales
        // this by the display density, which the browser does not do for us: a mouse or
        // touch point in CSS pixels needs the wider slop to feel the same.
        tapTolerance: 48,
        markerDropAnimateDuration: 300,
        markerBounceAnimateDuration: 2000,
        iconSize: MarkerIconSize.Regular,
        iconStroke: 1,
        composeEventDebounce: 5,
    }),
});
