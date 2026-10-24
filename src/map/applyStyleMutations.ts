import { styleMutationTarget, type StyleMutation } from './StyleMutation';

/**
 * The part of a GL-JS map that a style mutation needs.
 *
 * Structural on purpose. MapLibre GL JS, Mapbox GL JS and the MapTiler SDK
 * (which wraps MapLibre) all expose these under the same names, so one
 * applier serves three providers — and core stays free of all three, which
 * it has to be: every package in the SDK depends on core and none of them
 * should pull a renderer in with it.
 */
export interface StylePatchableMap {
    /**
     * Whether the map has a style up to be changed.
     *
     * **False is not failure, and must not be reported as one.** A map with
     * no style loaded yet answers `undefined` to every `getLayer`, so
     * without this every mutation came back as one the map "cannot" make —
     * which is how an app got told "N adjustments were not applied" about a
     * map that was merely still loading, and, under the reloading policy,
     * had the adjusted document handed to it for no reason. Nothing is lost
     * by waiting: the store puts the whole set back when the style loads.
     *
     * Optional because it is read structurally off whatever map was handed
     * in; all three GL-JS-family SDKs have it.
     *
     * `boolean | void` because MapLibre answers nothing at all before the
     * style object exists — which is precisely the case this is here for,
     * so the result is read as falsy rather than compared to `false`.
     */
    isStyleLoaded?(): boolean | void;
    getLayer(id: string): unknown;
    setPaintProperty(layerId: string, name: string, value: unknown): void;
    setLayoutProperty(layerId: string, name: string, value: unknown): void;
    setFilter(layerId: string, filter?: unknown): void;
    setLayerZoomRange(layerId: string, minzoom: number, maxzoom: number): void;
    addLayer(layer: unknown, beforeId?: string): void;
    removeLayer(id: string): void;
}

/**
 * Applies style mutations to a live GL-JS map.
 *
 * The body of a provider's {@link VectorStyleMutationSupport}: a provider
 * wires this into a `StyleMutationStore` and registers that, and the three
 * MapLibre-family providers then behave identically by construction.
 *
 * @returns the mutations it could not apply. A layer the loaded style does
 *   not have, or a property the renderer rejected: the caller is told
 *   rather than left to assume the map looks the way the rules asked.
 *   Nothing is thrown — one bad property must not cost the other three
 *   hundred. Empty while the map has no style up, because then there is
 *   nothing it could not do — only something it has not done yet.
 */
export function applyStyleMutations(
    map: StylePatchableMap,
    mutations: readonly StyleMutation[],
): StyleMutation[] {
    // Not ready is not a refusal. See {@link StylePatchableMap.isStyleLoaded}.
    // Tested for rather than called through `?.`: a map without the call at
    // all is taken to be ready, which is what every map was before this
    // existed, while one that answers `undefined` -- MapLibre, before the
    // style object exists -- is not. Comparing to `false` would have missed
    // exactly that case.
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return [];
    const unapplied: StyleMutation[] = [];
    for (const mutation of mutations) {
        try {
            if (!applyOne(map, mutation)) unapplied.push(mutation);
        } catch {
            unapplied.push(mutation);
        }
    }
    return unapplied;
}

function applyOne(map: StylePatchableMap, mutation: StyleMutation): boolean {
    switch (mutation.op) {
        case 'setPaint':
            if (!map.getLayer(mutation.layerId)) return false;
            map.setPaintProperty(mutation.layerId, mutation.key, read(mutation.value));
            return true;
        case 'setLayout':
            if (!map.getLayer(mutation.layerId)) return false;
            map.setLayoutProperty(mutation.layerId, mutation.key, read(mutation.value));
            return true;
        case 'setFilter':
            if (!map.getLayer(mutation.layerId)) return false;
            // `undefined` removes the filter; `null` would be read as one.
            map.setFilter(mutation.layerId, read(mutation.value) ?? undefined);
            return true;
        case 'setZoomRange': {
            if (!map.getLayer(mutation.layerId)) return false;
            // The spec's own defaults, for a layer that named neither. GL-JS
            // takes both ends at once, so a mutation that changes one has to
            // restate the other.
            map.setLayerZoomRange(mutation.layerId, mutation.minZoom ?? 0, mutation.maxZoom ?? 24);
            return true;
        }
        // Adding and removing guard themselves rather than going through the
        // `getLayer` check above, because what "already there" means is the
        // renderer's own question -- which is why on Android the guard sits
        // in each provider's adapter. Here one applier *is* the adapter for
        // all three GL-JS renderers, so it sits here.
        case 'addLayer': {
            const layer = read(mutation.layer);
            if (typeof layer !== 'object' || layer === null) return false;
            // The style was reloaded and the whole set is going back on;
            // GL-JS throws on a duplicate id.
            if (map.getLayer(mutation.layerId)) return true;
            map.addLayer(layer, mutation.beforeId ?? undefined);
            return true;
        }
        case 'removeLayer':
            if (!map.getLayer(mutation.layerId)) return true;
            map.removeLayer(mutation.layerId);
            return true;
    }
}

/**
 * A mutation's value, which travels as JSON text.
 *
 * Text because Android wants a Gson tree and iOS an `NSExpression`; here it
 * is a `JSON.parse` away from what `setPaintProperty` wants.
 */
function read(json: string): unknown {
    try {
        return JSON.parse(json) as unknown;
    } catch {
        return undefined;
    }
}

/** For a message naming what would not apply. */
export function describeStyleMutations(mutations: readonly StyleMutation[]): string {
    return mutations.map(styleMutationTarget).join(', ');
}
