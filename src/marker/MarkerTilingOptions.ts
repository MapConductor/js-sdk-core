import type { MarkerState } from './MarkerState';

/**
 * Options for marker tiling optimization.
 *
 * When enabled, large sets of static markers can be rendered as tile overlays
 * to avoid per-marker add/update cost in native map SDKs.
 * Mirrors `MarkerTilingOptions` from `MarkerTilingOptions.kt`.
 */
export interface MarkerTilingOptions {
    readonly enabled: boolean;
    readonly debugTileOverlay: boolean;
    readonly minMarkerCount: number;
    readonly cacheSize: number;
    /**
     * Per-marker icon scale multiplier applied during tile rendering.
     * `(zoom: number, state: MarkerState) => number`
     */
    readonly iconScaleCallback: ((state: MarkerState, zoom: number) => number) | null;
}

export namespace MarkerTilingOptions {
    export const Default: MarkerTilingOptions = {
        enabled: true,
        debugTileOverlay: false,
        minMarkerCount: 2000,
        cacheSize: 8 * 1024 * 1024,
        iconScaleCallback: null,
    };

    export const Disabled: MarkerTilingOptions = {
        ...Default,
        enabled: false,
    };
}
