/**
 * One change to one layer of a vector style the map has already loaded.
 *
 * This is what lets a style be adjusted without being reloaded. Handing a
 * map a new style document is the obvious way to change how it looks, and on
 * every provider it is the expensive way: the renderer drops its tiles,
 * re-reads the document, re-tessellates, and the overlays the app added have
 * to be put back. A paint property set in place costs none of that.
 *
 * Mutations are produced by the vector style compiler from the same
 * evaluation that produces the adjusted document, so the two can never
 * disagree about what the style should look like. A provider that can take
 * them declares {@link VectorStyleMutationSupport}.
 *
 * ## Why the values are JSON text
 *
 * A style property's value is anything the style spec allows: a string, a
 * number, or an expression tree. `map.setPaintProperty` here wants the
 * parsed value, MapLibre on Android wants a Gson tree, MapLibre on iOS an
 * `NSExpression` -- no shared typed representation saves anyone a
 * conversion. Text is the one form all three start from, and it is what
 * crossed the wasm boundary anyway.
 *
 * `"null"` means the property had no value, which is also how a renderer is
 * told to go back to the spec default.
 *
 * android-sdk-core and ios-sdk-core carry the same type. A discriminated
 * union here against a sealed class and an enum there: the same shape in
 * each language's own grammar.
 */
export type StyleMutation =
    | { readonly op: 'setPaint'; readonly layerId: string; readonly key: string; readonly value: string; readonly previous: string }
    | { readonly op: 'setLayout'; readonly layerId: string; readonly key: string; readonly value: string; readonly previous: string }
    | { readonly op: 'setFilter'; readonly layerId: string; readonly value: string; readonly previous: string }
    | {
          readonly op: 'setZoomRange';
          readonly layerId: string;
          readonly minZoom: number | null;
          readonly maxZoom: number | null;
          readonly previousMinZoom: number | null;
          readonly previousMaxZoom: number | null;
      }
    /**
     * Adds a layer the style did not have.
     *
     * Used for one thing: a background under a style that has none, so that
     * "everything else muted" looks the same whether the style is drawn by
     * the map or rasterised into tiles over another basemap. Without it the
     * raster path leaves the gaps transparent and the two disagree.
     */
    | {
          readonly op: 'addLayer';
          /**
           * The new layer's id, carried rather than read back out of
           * `layer`: the compiler knew it, every reader needs it, and three
           * JSON parses of the same object to recover it are three chances
           * to get it wrong.
           */
          readonly layerId: string;
          readonly layer: string;
          readonly beforeId: string | null;
      }
    | { readonly op: 'removeLayer'; readonly layerId: string };

/** The layer a mutation acts on, or undefined for one that names no layer. */
export function styleMutationLayerId(mutation: StyleMutation): string {
    return mutation.layerId;
}

/**
 * What a mutation occupies, for working out which of two sets of mutations
 * replace each other. Two mutations with the same target are the same change
 * with different values.
 */
export function styleMutationTarget(mutation: StyleMutation): string {
    switch (mutation.op) {
        case 'setPaint':
            return `paint|${mutation.layerId}|${mutation.key}`;
        case 'setLayout':
            return `layout|${mutation.layerId}|${mutation.key}`;
        case 'setFilter':
            return `filter|${mutation.layerId}`;
        case 'setZoomRange':
            return `zoom|${mutation.layerId}`;
        case 'addLayer':
            return `add|${mutation.layerId}`;
        case 'removeLayer':
            return `add|${mutation.layerId}`;
    }
}

/**
 * What a mutation changes, named the way the style spec names it.
 *
 * For telling an app *what* a renderer would not do. The layer is the wrong
 * thing to name on its own: when a backend has no property for a spec key,
 * the same key fails on every layer that uses it, so a list of layers is
 * hundreds of names for one cause while the key is the cause.
 */
export function styleMutationProperty(mutation: StyleMutation): string {
    switch (mutation.op) {
        case 'setPaint':
        case 'setLayout':
            return mutation.key;
        case 'setFilter':
            return 'filter';
        case 'setZoomRange':
            return 'zoom range';
        default:
            return 'layer';
    }
}

/** The mutation that puts back what was there, or null when there is nothing to put back. */
export function reverseStyleMutation(mutation: StyleMutation): StyleMutation | null {
    switch (mutation.op) {
        case 'setPaint':
        case 'setLayout':
            return { ...mutation, value: mutation.previous, previous: mutation.value };
        case 'setFilter':
            return { ...mutation, value: mutation.previous, previous: mutation.value };
        case 'setZoomRange':
            return {
                ...mutation,
                minZoom: mutation.previousMinZoom,
                maxZoom: mutation.previousMaxZoom,
                previousMinZoom: mutation.minZoom,
                previousMaxZoom: mutation.maxZoom,
            };
        case 'addLayer':
            return { op: 'removeLayer', layerId: mutation.layerId };
        case 'removeLayer':
            return null;
    }
}

/**
 * Reads the compiler's `mutations` array.
 *
 * An entry this version does not know is skipped rather than fatal: the
 * array is produced by the wasm this package shipped with, so an unknown op
 * means the two went out of step, and dropping one change is better than
 * losing every change.
 */
export function parseStyleMutations(json: string): StyleMutation[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(readOne).filter((m): m is StyleMutation => m !== null);
}

function readOne(raw: unknown): StyleMutation | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    const layerId = typeof entry.layerId === 'string' ? entry.layerId : undefined;
    const key = typeof entry.key === 'string' ? entry.key : undefined;
    switch (entry.op) {
        case 'setPaint':
            if (layerId === undefined || key === undefined) return null;
            return { op: 'setPaint', layerId, key, value: jsonText(entry.value), previous: jsonText(entry.previous) };
        case 'setLayout':
            if (layerId === undefined || key === undefined) return null;
            return { op: 'setLayout', layerId, key, value: jsonText(entry.value), previous: jsonText(entry.previous) };
        case 'setFilter':
            if (layerId === undefined) return null;
            return { op: 'setFilter', layerId, value: jsonText(entry.value), previous: jsonText(entry.previous) };
        case 'setZoomRange':
            if (layerId === undefined) return null;
            return {
                op: 'setZoomRange',
                layerId,
                minZoom: numberOrNull(entry.minZoom),
                maxZoom: numberOrNull(entry.maxZoom),
                previousMinZoom: numberOrNull(entry.previousMinZoom),
                previousMaxZoom: numberOrNull(entry.previousMaxZoom),
            };
        case 'addLayer':
            if (layerId === undefined) return null;
            if (typeof entry.layer !== 'object' || entry.layer === null) return null;
            return {
                op: 'addLayer',
                layerId,
                layer: JSON.stringify(entry.layer),
                beforeId: typeof entry.beforeId === 'string' ? entry.beforeId : null,
            };
        case 'removeLayer':
            return layerId === undefined ? null : { op: 'removeLayer', layerId };
        default:
            return null;
    }
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonText(value: unknown): string {
    // `undefined` stringifies to `undefined`, which is not JSON.
    return value === undefined ? 'null' : JSON.stringify(value);
}

