/**
 * Ownership of the icon bitmaps handed to the Service Worker.
 *
 * `IconImageCache` owns what it hands out and calls `close()` on an entry the
 * moment its LRU evicts it. `MarkerTileRenderer.toSWData()` collects icons one
 * at a time and posts them only at the end, so with more distinct icons than
 * the cache holds, the entries collected first are already detached by the
 * time the payload is cloned — and structured-cloning a detached ImageBitmap
 * throws `DataCloneError`, taking the whole registration with it.
 *
 * The fix is ownership, not a bigger cache: the payload gets copies it owns,
 * and whoever posts it frees them afterwards.
 */

/**
 * Copies made here, so `closeSWIcons()` can tell them apart from bitmaps that
 * still belong to the cache and must not be closed.
 */
const owned = new WeakSet<ImageBitmap>();

/**
 * A copy of `source` that the payload owns.
 *
 * Falls back to `source` itself where no copy can be made; that is what the
 * code did before this existed, so the fallback is never worse — and since it
 * is not marked owned, `closeSWIcons()` leaves it for the cache to free.
 */
export async function copyIconBitmap(source: ImageBitmap): Promise<ImageBitmap> {
    if (typeof createImageBitmap !== 'function') return source;
    try {
        const copy = await createImageBitmap(source);
        owned.add(copy);
        return copy;
    } catch (err) {
        console.warn('[MapConductor] toSWData: could not copy an icon bitmap, sharing the cached one', err);
        return source;
    }
}

/**
 * Release the copies in a payload that has already been posted.
 *
 * Safe to call once the `postMessage` has returned: structured cloning happens
 * synchronously inside it, so the Service Worker already holds its own copy.
 */
export function closeSWIcons(icons: readonly { bitmap: ImageBitmap }[]): void {
    for (const icon of icons) {
        if (!owned.has(icon.bitmap)) continue; // cache-owned; not ours to close
        owned.delete(icon.bitmap);
        if (typeof icon.bitmap.close === 'function') icon.bitmap.close();
    }
}
