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
    /**
     * Keep one marker per cell of this many pixels, or 0 to keep them all.
     *
     * Markers a few pixels apart overlap almost completely, so thinning them is
     * a judgement about the map rather than a free optimisation — hence opt-in.
     * Tokyo's street trees are planted metres apart along a road: below street
     * level most of them sit on top of one another, and one per icon width
     * halves the tile bytes while showing the same map.
     *
     * Zero still drops markers that agree exactly — same rectangle, same icon —
     * which cannot change the tile.
     *
     * android-sdk's MarkerTilingOptions carries the same field.
     */
    readonly declutterPx: number;
}

export namespace MarkerTilingOptions {
    export const Default: MarkerTilingOptions = {
        enabled: true,
        debugTileOverlay: false,
        minMarkerCount: 2000,
        cacheSize: 8 * 1024 * 1024,
        iconScaleCallback: null,
        declutterPx: 0,
    };

    export const Disabled: MarkerTilingOptions = {
        ...Default,
        enabled: false,
    };
}
