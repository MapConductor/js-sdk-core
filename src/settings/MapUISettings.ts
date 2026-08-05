/**
 * Which map gestures the user is allowed to perform.
 *
 * Mirrors `MapUISettings` on Android and iOS. Every flag defaults to `true`, so
 * the default value leaves the provider's own behaviour untouched.
 *
 * Not every provider can honour every flag. Some map engines bundle two gestures
 * into one handler, and Leaflet, OpenLayers and the HERE 2D web view fake bearing
 * and tilt with a CSS transform — there is no rotate or tilt *gesture* there to
 * switch off. Setting an unsupported flag to `false` is ignored and logs a
 * one-time warning; see {@link MapUISettingsDiagnostics}.
 */
export interface MapUISettings {
    /** Pan / drag the map. */
    scrollGesture: boolean;
    /** Wheel, pinch and double-click zoom. */
    zoomGesture: boolean;
    /** Rotate the map (change bearing). */
    rotateGesture: boolean;
    /** Tilt the map (change pitch). */
    tiltGesture: boolean;
}

/** All gestures enabled — the default. */
export const DefaultMapUISettings: Readonly<MapUISettings> = Object.freeze({
    scrollGesture: true,
    zoomGesture: true,
    rotateGesture: true,
    tiltGesture: true,
});

/** Every gesture disabled; the map becomes non-interactive. */
export const NoMapUISettings: Readonly<MapUISettings> = Object.freeze({
    scrollGesture: false,
    zoomGesture: false,
    rotateGesture: false,
    tiltGesture: false,
});

/** Fills in any omitted flag with the default (`true`). */
export function resolveMapUISettings(
    settings?: Partial<MapUISettings> | null,
): MapUISettings {
    return { ...DefaultMapUISettings, ...(settings ?? {}) };
}

/** The gestures {@link MapUISettings} can turn on and off. */
export type MapGesture = 'scroll' | 'zoom' | 'rotate' | 'tilt';

const warned = new Set<string>();

/**
 * Reports gesture flags a provider cannot honour.
 *
 * Providers call {@link warnIfRequested} when a flag is set to `false` that their
 * map engine has no way to disable. Warnings are logged once per provider+gesture
 * so a component that re-renders on every camera move does not flood the console.
 */
export const MapUISettingsDiagnostics = {
    /**
     * Logs once if `requested` is `false` — i.e. the app asked to disable a
     * gesture this provider cannot disable. A `true` value needs no warning,
     * because leaving a gesture enabled is always achievable.
     */
    warnIfRequested(
        requested: boolean,
        gesture: MapGesture,
        provider: string,
        reason: string,
    ): void {
        if (requested) return;
        const key = `${provider}.${gesture}`;
        if (warned.has(key)) return;
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
            `MapConductor: ${gesture}Gesture is not supported by ${provider} (${reason}); the setting is ignored.`,
        );
    },

    /** Test hook — forget which warnings have already been logged. */
    resetWarnings(): void {
        warned.clear();
    },
};
