/** Decodes BitmapIcon.url (a self-contained data: URL) into a drawable image, with dedup + caching. */
export class IconImageCache {
    /**
     * @param pixelRatio Device pixels per CSS pixel the icons will be drawn at.
     *   An SVG icon (the default pins) is rasterized at its own size times this,
     *   so a 2x tile gets a 2x icon instead of a 1x one stretched. A raster icon
     *   is used as it is: drawn at its `BitmapIcon.size`, it is as sharp as the
     *   pixels it was made with, so an app wanting 2x supplies a 2x image.
     */
    constructor(private readonly pixelRatio: number = 1) {}

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

    /**
     * An SVG drawn onto a canvas `pixelRatio` times its own size, or null when
     * there is nothing to gain (1x, a raster image) or no canvas to draw on.
     * Decoded at its own size, an SVG is a 1x bitmap like any other.
     */
    private rasterizeVector(url: string, img: HTMLImageElement): OffscreenCanvas | HTMLCanvasElement | null {
        if (this.pixelRatio <= 1 || !url.startsWith('data:image/svg+xml')) return null;
        const width = Math.max(1, Math.round((img.naturalWidth || img.width) * this.pixelRatio));
        const height = Math.max(1, Math.round((img.naturalHeight || img.height) * this.pixelRatio));
        let canvas: OffscreenCanvas | HTMLCanvasElement;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(width, height);
        } else if (typeof document !== 'undefined') {
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
        } else {
            return null;
        }
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);
        return canvas;
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
            const rasterized = this.rasterizeVector(url, img);
            if (typeof createImageBitmap === 'function') {
                try {
                    return await createImageBitmap(rasterized ?? img);
                } catch (err) {
                    // Still drawable via drawImage() on the main thread, just
                    // not transferable to the SW (toSWData() will fall back
                    // to the default icon for this entry).
                    console.warn('[MapConductor] MarkerTileRenderer: createImageBitmap(<img>) failed, using <img> directly', err);
                    return img;
                }
            }
            return rasterized ?? img;
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
