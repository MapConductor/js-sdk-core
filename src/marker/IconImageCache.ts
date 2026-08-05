/** Decodes BitmapIcon.url (a self-contained data: URL) into a drawable image, with dedup + caching. */
export class IconImageCache {
    private readonly ready = new Map<string, ImageBitmap | HTMLImageElement>();
    private readonly pending = new Map<string, Promise<ImageBitmap | HTMLImageElement | null>>();
    // Permanently-undecodable URLs (e.g. malformed data: URL). Cached so a
    // broken icon doesn't get retried on every renderTile() call.
    private readonly failed = new Set<string>();

    // android-sdk（BitmapIconCache: maxMemory/8 の LRU）/ ios-sdk（NSCache.totalCostLimit）
    // に相当する上限。Web では ImageBitmap のバイト数を取れないためエントリ数で LRU 退避する。
    private static readonly MAX_READY_ENTRIES = 512;
    private static readonly MAX_FAILED_ENTRIES = 512;

    get(url: string): ImageBitmap | HTMLImageElement | undefined {
        const img = this.ready.get(url);
        if (img !== undefined) {
            // LRU: 参照されたものを最近使用として末尾へ移動する。
            this.ready.delete(url);
            this.ready.set(url, img);
        }
        return img;
    }

    /** Decode (or return the in-flight/cached decode of) an icon image. Never throws. */
    async ensure(url: string): Promise<ImageBitmap | HTMLImageElement | null> {
        const cached = this.ready.get(url);
        if (cached) return cached;
        if (this.failed.has(url)) return null;
        const inFlight = this.pending.get(url);
        if (inFlight) return inFlight;

        const promise = this.decode(url)
            .then((img) => {
                if (img) {
                    this.ready.set(url, img);
                    this.evictReadyIfNeeded();
                } else {
                    this.addFailed(url);
                    console.warn('[MapConductor] MarkerTileRenderer: failed to decode icon image', url.slice(0, 64));
                }
                return img;
            })
            .catch((err) => {
                this.addFailed(url);
                console.warn('[MapConductor] MarkerTileRenderer: icon decode threw', err);
                return null;
            })
            .finally(() => {
                this.pending.delete(url);
            });
        this.pending.set(url, promise);
        return promise;
    }

    private evictReadyIfNeeded(): void {
        while (this.ready.size > IconImageCache.MAX_READY_ENTRIES) {
            const oldest = this.ready.keys().next().value;
            if (oldest === undefined) break;
            const evicted = this.ready.get(oldest);
            this.ready.delete(oldest);
            // ImageBitmap は GPU メモリを保持するので明示的に解放する。
            if (evicted != null && "close" in evicted && typeof evicted.close === "function") {
                evicted.close();
            }
        }
    }

    private addFailed(url: string): void {
        this.failed.add(url);
        while (this.failed.size > IconImageCache.MAX_FAILED_ENTRIES) {
            const oldest = this.failed.values().next().value;
            if (oldest === undefined) break;
            this.failed.delete(oldest);
        }
    }

    private async decode(url: string): Promise<ImageBitmap | HTMLImageElement | null> {
        // <img>.decode() is the most format-reliable path for an arbitrary
        // data: URL (handles SVG as well as raster formats uniformly) and is
        // available on the main thread. Convert the result to an ImageBitmap
        // when possible, since that's required to structured-clone the icon
        // to the Service Worker (see toSWData()) and is also a valid
        // drawImage() source — falling back to fetch()+blob only covers
        // contexts where `Image` doesn't exist (e.g. a Worker).
        if (typeof Image !== 'undefined') {
            const img = new Image();
            img.src = url;
            try {
                await img.decode();
            } catch (err) {
                console.warn('[MapConductor] MarkerTileRenderer: <img>.decode() failed for icon', err);
                return null;
            }
            if (typeof createImageBitmap === 'function') {
                try {
                    return await createImageBitmap(img);
                } catch (err) {
                    // Still drawable via drawImage() on the main thread, just
                    // not transferable to the SW (toSWData() will fall back
                    // to the default icon for this entry).
                    console.warn('[MapConductor] MarkerTileRenderer: createImageBitmap(<img>) failed, using <img> directly', err);
                    return img;
                }
            }
            return img;
        }
        if (typeof createImageBitmap === 'function') {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                return await createImageBitmap(blob);
            } catch (err) {
                console.warn('[MapConductor] MarkerTileRenderer: fetch+createImageBitmap failed for icon', err);
                return null;
            }
        }
        return null;
    }
}
