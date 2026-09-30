import type { AttributionRule } from './AttributionRule';
import type { MapDesignTypeInterface } from './MapDesignTypeInterface';
import { createMapServiceKey, type MapServiceKey } from './MapServiceRegistry';
import type { MapViewStateInterface } from './MapViewState';

/**
 * A map that can draw a MapLibre style itself.
 *
 * MapLibre, Mapbox and MapTiler are vector renderers already: handing them a
 * style is cheaper than rasterising it in a worker and feeding the result back
 * as PNG tiles, which is what a backend that only takes raster (Google Maps,
 * Leaflet, ArcGIS, Cesium...) has to be given. A provider that can take the
 * style directly registers this under {@link VectorStyleSupportKey}; a layer
 * that has a style to show looks the key up and, if it is there, skips the
 * rasteriser altogether.
 *
 * The style *becomes the basemap*: on every provider that can do this, the
 * style is the map, so showing one replaces the design the state names and
 * clearing it puts that design back. A style drawn this way is not an overlay
 * -- it has no opacity, and nothing of the previous basemap shows through it.
 * Anything that needs the style on top of another basemap goes through the
 * raster path.
 *
 * android-sdk-core and ios-sdk-core carry the same capability. There the
 * style is a URL served by the local tile server; in the browser the map
 * takes the parsed object directly, which is what `style` may be.
 */
export interface VectorStyleSupport {
    /**
     * Draws `style` -- a `style.json` URL or the parsed object -- as the map's
     * basemap. `attributionRules` are the credits the style's sources ask for,
     * carried by the design so the map's attribution overlay shows them for as
     * long as the style is up.
     */
    showStyle(style: string | object, attributionRules?: readonly AttributionRule[]): void;
    /**
     * Restores the design that was showing before {@link showStyle}, unless
     * the app has since chosen another one, in which case that choice is left
     * alone.
     */
    clearStyle(): void;
}

/**
 * {@link VectorStyleSupport} の登録キー。
 *
 * 宣言しないプロバイダは「スタイルは受け取れない」。ベクタータイル層はその場合
 * ラスタータイルに描いて渡す。
 */
export const VectorStyleSupportKey: MapServiceKey<VectorStyleSupport> =
    createMapServiceKey<VectorStyleSupport>();

/**
 * What identifies a style: its URL, or a digest of its content.
 *
 * The design a style is shown as is keyed by this. A map only re-reads a style
 * whose key changed, so a changed style must change the key -- and a remount
 * with the same style must not.
 */
export function vectorStyleKey(style: string | object): string {
    if (typeof style === 'string') return `vector-style:${style}`;
    // FNV-1a over the JSON text. Stable, cheap, and only computed on a change.
    const text = JSON.stringify(style);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `vector-style:${hash.toString(16)}`;
}

/**
 * {@link VectorStyleSupport} for a provider whose design type can carry a style.
 *
 * The MapLibre-based providers differ only in how a style is wrapped into
 * their design type, which is what `designFor` supplies; the remember-and-
 * restore dance is the same for all of them and lives here once. The "still
 * ours" check on {@link clearStyle} is what keeps this from fighting an app
 * that switched designs while the style was up: a layer unmounting must not
 * undo a choice the app made after it.
 *
 * {@link clearStyle} takes effect a moment later rather than at once, and a
 * {@link showStyle} of the same style in between cancels it. A view that
 * rebuilds on a design change remounts the layer that asked for the style
 * *by the change it caused* -- React's strict-mode double effects do the same
 * -- and clearing on that unmount would restore the old design, which would
 * rebuild again, without end. Waiting a beat lets the remount cancel it.
 */
export class VectorStyleAsDesign<D extends MapDesignTypeInterface<string>> implements VectorStyleSupport {
    private installed: D | null = null;
    private installedKey: string | null = null;
    private previous: D | null = null;
    private pendingClear: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly state: MapViewStateInterface<D>,
        private readonly designFor: (
            style: string | object,
            key: string,
            attributionRules: readonly AttributionRule[],
        ) => D,
    ) {}

    showStyle(style: string | object, attributionRules: readonly AttributionRule[] = []): void {
        if (this.pendingClear !== null) {
            clearTimeout(this.pendingClear);
            this.pendingClear = null;
        }
        const key = vectorStyleKey(style);
        // Same style, still up: nothing to do, and writing the design again
        // would rebuild the map for nothing.
        if (this.installed && this.installedKey === key && this.state.mapDesignType.id === this.installed.id) {
            return;
        }
        const design = this.designFor(style, key, attributionRules);
        // Showing a second style over the first keeps the *original* design as
        // the one to go back to; the intermediate style was never the app's
        // basemap.
        if (!this.installed) this.previous = this.state.mapDesignType;
        this.installed = design;
        this.installedKey = key;
        this.state.mapDesignType = design;
    }

    clearStyle(): void {
        if (!this.installed) return;
        if (this.pendingClear !== null) clearTimeout(this.pendingClear);
        this.pendingClear = setTimeout(() => {
            this.pendingClear = null;
            const current = this.installed;
            const restore = this.previous;
            this.installed = null;
            this.installedKey = null;
            this.previous = null;
            if (current && restore && this.state.mapDesignType.id === current.id) {
                this.state.mapDesignType = restore;
            }
        }, CLEAR_GRACE_MS);
    }
}

/** Longer than a frame, shorter than anyone notices. */
const CLEAR_GRACE_MS = 100;
