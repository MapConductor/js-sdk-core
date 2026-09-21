/**
 * What a tile request resolved to.
 *
 * The distinction that matters is **empty** versus **failed**, because a map
 * library remembers them differently. A spot with nothing on it is a real
 * answer — a transparent picture, cacheable, replaced when the data version
 * moves the tile URL. A render that could not be completed right now is not:
 * answering it with a transparent picture paints a hole and caches it, and the
 * library never asks again, so the neighbouring tiles' overhang is cut off at
 * its edge.
 *
 * ios-sdk's `LocalTileServer.TileOutcome` and android-sdk-core's
 * `LocalTileServer.TileOutcome` are the same four cases.
 */
export type TileOutcome =
    | { readonly kind: 'tile'; readonly bytes: Uint8Array }
    /** Nothing to draw here. Answer with a transparent tile. */
    | { readonly kind: 'empty' }
    /** The provider could not draw it now. The caller should retry, not cache. */
    | { readonly kind: 'failed' }
    /** Nothing of that name: an unknown route, or a path that is not a tile. */
    | { readonly kind: 'notFound' };

/**
 * A 1x1 transparent PNG, which scales to whatever the map draws it into.
 *
 * Shared so the several places that answer "empty" all answer with the same
 * bytes; the copies that used to live in each provider said the same thing in
 * seven different arrays.
 */
export const TRANSPARENT_TILE_PNG: Uint8Array = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 11, 73, 68, 65, 84, 8, 215, 99, 96, 0, 2, 0, 0, 5, 0, 1, 226, 38, 5, 155,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/**
 * Thrown by the helpers that hand tiles straight to a map library, where the
 * only way to say "this one failed, ask again" is to reject.
 */
export class TileRenderFailedError extends Error {
    constructor(routeId: string, request: { x: number; y: number; z: number }) {
        super(`tile render failed: ${routeId} z=${request.z} x=${request.x} y=${request.y}`);
        this.name = 'TileRenderFailedError';
    }
}
