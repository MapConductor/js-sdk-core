import type { TileProvider } from '../tileserver/TileProvider';
import type { TileRequest } from '../tileserver/TileRequest';
import type { GeoPoint } from '../features';
import type { MarkerIcon } from './MarkerIcon';
import type { BitmapIcon } from './MarkerOverlayRenderer';
import { createDefaultIcon } from './DefaultMarkerIcon';

export const MARKER_HIT_RADIUS_TOUCH_PX = 20;
export const MARKER_HIT_RADIUS_MOUSE_PX = 6;

export interface MarkerTileRenderingOptions<T = never> {
    tileSize?: number;
    /** Return an icon scale factor for a given item and zoom level. Defaults to a built-in zoom curve. */
    iconScaleCallback?: (item: T, zoom: number) => number;
    /**
     * Extra multiplier applied on top of iconScaleCallback, independent of
     * MarkerIcon.scale (which is already baked into BitmapIcon.size by
     * toBitmapIcon()). Mirrors Android/iOS MarkerTileRenderer.extraIconScale;
     * only non-1 SDKs need to override the default.
     */
    extraIconScale?: number;
}

function defaultIconScale(zoom: number): number {
    if (zoom > 12) return 1.3;
    if (zoom > 10) return 1.0;
    if (zoom > 8) return 0.8;
    if (zoom > 5) return 0.5;
    return 0.2;
}

function toWorldPixel(lat: number, lng: number, z: number): { wx: number; wy: number } {
    const scale = 256 * Math.pow(2, z);
    const wx = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { wx, wy };
}

function tileToGeoBounds(x: number, y: number, z: number, tileSize: number): {
    north: number; south: number; west: number; east: number;
} {
    const n = Math.pow(2, z);
    const tilesPerWorld = (256 / tileSize) * n; // in case tileSize !== 256, keep it in "256-equivalent" tile units
    const west = (x / tilesPerWorld) * 360 - 180;
    const east = ((x + 1) / tilesPerWorld) * 360 - 180;
    const latRad = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tilesPerWorld)));
    const north = (latRad(y) * 180) / Math.PI;
    const south = (latRad(y + 1) * 180) / Math.PI;
    return { north, south, west, east };
}

/** Uniform lat/lng grid used to cull the candidate set per tile without scanning every marker. */
class GeoGridIndex<T extends { position: GeoPoint }> {
    private readonly cells = new Map<string, T[]>();
    private static readonly CELL_DEG = 0.02;
    // If a bounds query would need to scan more cells than this, brute-force
    // scanning `items` directly is comparably cheap and avoids pathological
    // cell-iteration costs for very large (near-global) bounds.
    private static readonly MAX_CELLS_PER_QUERY = 4000;

    constructor(private readonly items: ReadonlyArray<T>) {
        for (const item of items) {
            const key = this.cellKey(item.position.latitude, item.position.longitude);
            const bucket = this.cells.get(key);
            if (bucket) bucket.push(item);
            else this.cells.set(key, [item]);
        }
    }

    private cellKey(lat: number, lng: number): string {
        const cx = Math.floor(lng / GeoGridIndex.CELL_DEG);
        const cy = Math.floor(lat / GeoGridIndex.CELL_DEG);
        return `${cx}:${cy}`;
    }

    /** Items whose position falls within the given padded lat/lng bounds. */
    queryBounds(south: number, north: number, west: number, east: number): T[] {
        const cellDeg = GeoGridIndex.CELL_DEG;
        const cx0 = Math.floor(west / cellDeg);
        const cx1 = Math.floor(east / cellDeg);
        const cy0 = Math.floor(south / cellDeg);
        const cy1 = Math.floor(north / cellDeg);
        const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

        if (!Number.isFinite(cellCount) || cellCount > GeoGridIndex.MAX_CELLS_PER_QUERY) {
            return this.items.filter((item) =>
                item.position.latitude >= south && item.position.latitude <= north &&
                item.position.longitude >= west && item.position.longitude <= east,
            );
        }

        const out: T[] = [];
        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
                const bucket = this.cells.get(`${cx}:${cy}`);
                if (!bucket) continue;
                for (const item of bucket) {
                    const { latitude, longitude } = item.position;
                    if (latitude >= south && latitude <= north && longitude >= west && longitude <= east) {
                        out.push(item);
                    }
                }
            }
        }
        return out;
    }
}

/** Decodes BitmapIcon.url (a self-contained data: URL) into a drawable image, with dedup + caching. */
class IconImageCache {
    private readonly ready = new Map<string, ImageBitmap | HTMLImageElement>();
    private readonly pending = new Map<string, Promise<ImageBitmap | HTMLImageElement | null>>();
    // Permanently-undecodable URLs (e.g. malformed data: URL). Cached so a
    // broken icon doesn't get retried on every renderTile() call.
    private readonly failed = new Set<string>();

    get(url: string): ImageBitmap | HTMLImageElement | undefined {
        return this.ready.get(url);
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
                } else {
                    this.failed.add(url);
                    console.warn('[MapConductor] MarkerTileRenderer: failed to decode icon image', url.slice(0, 64));
                }
                return img;
            })
            .catch((err) => {
                this.failed.add(url);
                console.warn('[MapConductor] MarkerTileRenderer: icon decode threw', err);
                return null;
            })
            .finally(() => {
                this.pending.delete(url);
            });
        this.pending.set(url, promise);
        return promise;
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

interface PreparedMarker {
    image: ImageBitmap | HTMLImageElement;
    centerNormX: number;
    centerNormY: number;
    drawW: number;
    drawH: number;
    anchorX: number;
    anchorY: number;
}

/**
 * Canvas-based tile renderer for large marker datasets.
 *
 * Mirrors Android/iOS MarkerTileRenderer: renders each marker's actual icon
 * (not a placeholder) onto Canvas tiles served via LocalTileServer, enabling
 * tens of thousands of markers without creating individual DOM elements.
 * A lat/lng grid index keeps per-tile queries proportional to the markers
 * actually near that tile instead of scanning the whole dataset.
 *
 * Also provides `findNearest()` for hit-testing click/tap events against the same
 * marker set, with an adaptive radius for touch vs. mouse input.
 */
export class MarkerTileRenderer<T extends { position: GeoPoint; icon?: MarkerIcon | null }>
    implements TileProvider {
    readonly tileSize: number;
    private readonly iconScale: (item: T, zoom: number) => number;
    private readonly extraIconScale: number;
    private readonly grid: GeoGridIndex<T>;
    private readonly icons = new IconImageCache();
    private readonly defaultBitmapIcon: BitmapIcon = createDefaultIcon().toBitmapIcon();
    /** Per-instance tile output cache; each sync creates a fresh renderer instance, so no invalidation is needed. */
    private readonly tileCache = new Map<string, Uint8Array | null>();

    constructor(
        private readonly items: ReadonlyArray<T>,
        options: MarkerTileRenderingOptions<T> = {},
    ) {
        this.tileSize = options.tileSize ?? 256;
        const cb = options.iconScaleCallback;
        this.iconScale = cb ?? ((_item, zoom) => defaultIconScale(zoom));
        this.extraIconScale = options.extraIconScale ?? 1.0;
        this.grid = new GeoGridIndex(items);
    }

    private bitmapIconOf(item: T): BitmapIcon {
        return item.icon?.toBitmapIcon() ?? this.defaultBitmapIcon;
    }

    /** Decode every unique icon up front. Call before relying on the synchronous renderTileDataUrl() path. */
    async preloadIcons(): Promise<void> {
        const urls = new Set<string>();
        for (const item of this.items) urls.add(this.bitmapIconOf(item).url);
        await Promise.all([...urls].map((url) => this.icons.ensure(url)));
    }

    private tileKey(req: TileRequest): string {
        return `${req.z}/${req.x}/${req.y}`;
    }

    private queryCandidates(z: number, x: number, y: number, paddingPx: number): T[] {
        const { north, south, west, east } = tileToGeoBounds(x, y, z, this.tileSize);
        // Approximate degrees-per-pixel padding using the tile's own lat span;
        // generous but cheap, matching the "conservative first pass" idea from
        // the Android/iOS renderer without needing a full projection inverse.
        const latSpan = north - south;
        const lonSpan = east - west || 1e-9;
        const padNorm = paddingPx / this.tileSize;
        const latPad = latSpan * padNorm;
        const lonPad = lonSpan * padNorm;
        return this.grid.queryBounds(south - latPad, north + latPad, west - lonPad, east + lonPad);
    }

    private prepareMarkers(
        candidates: T[],
        tileOriginWx: number,
        tileOriginWy: number,
        z: number,
        tilePx: number,
    ): { markers: PreparedMarker[]; maxHalfExtentPx: number } {
        let maxHalfExtentPx = 0;
        const markers: PreparedMarker[] = [];

        for (const item of candidates) {
            const bitmapIcon = this.bitmapIconOf(item);
            const image = this.icons.get(bitmapIcon.url);
            if (!image) continue; // not decoded yet; skip for this render (self-heals once cached)

            const { wx, wy } = toWorldPixel(item.position.latitude, item.position.longitude, z);
            const centerNormX = wx - tileOriginWx;
            const centerNormY = wy - tileOriginWy;
            if (centerNormX < -tilePx || centerNormX > 2 * tilePx || centerNormY < -tilePx || centerNormY > 2 * tilePx) {
                continue;
            }

            const callbackScale = Math.max(this.iconScale(item, z), 0);
            // bitmapIcon.size already includes MarkerIcon.scale (baked in by
            // toBitmapIcon()); do not multiply it again here.
            const scale = Math.max(callbackScale * this.extraIconScale, 0);
            const drawW = Math.max(bitmapIcon.size.width * scale, 1);
            const drawH = Math.max(bitmapIcon.size.height * scale, 1);
            const anchorX = bitmapIcon.anchor.x;
            const anchorY = bitmapIcon.anchor.y;

            const halfX = Math.max(Math.abs(drawW * anchorX), Math.abs(drawW * (1 - anchorX)));
            const halfY = Math.max(Math.abs(drawH * anchorY), Math.abs(drawH * (1 - anchorY)));
            maxHalfExtentPx = Math.max(maxHalfExtentPx, halfX, halfY);

            markers.push({ image, centerNormX, centerNormY, drawW, drawH, anchorX, anchorY });
        }

        return { markers, maxHalfExtentPx };
    }

    /** Kick off (but don't await) decoding for any candidate not yet in the icon cache. */
    private warmIcons(candidates: T[]): void {
        for (const item of candidates) {
            const url = this.bitmapIconOf(item).url;
            if (!this.icons.get(url)) void this.icons.ensure(url);
        }
    }

    private createCanvas(size: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(size, size);
            const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D | null;
            if (ctx) return { canvas, ctx };
        }
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('MarkerTileRenderer: failed to acquire a 2D canvas context');
        return { canvas, ctx };
    }

    private draw(markers: PreparedMarker[], tilePx: number, paddingPx: number): OffscreenCanvas | HTMLCanvasElement {
        const offscreenSize = tilePx + paddingPx * 2;
        const { canvas: offscreen, ctx: offCtx } = this.createCanvas(offscreenSize);
        for (const m of markers) {
            const centerX = m.centerNormX + paddingPx;
            const centerY = m.centerNormY + paddingPx;
            const dx = centerX - m.drawW * m.anchorX;
            const dy = centerY - m.drawH * m.anchorY;
            offCtx.drawImage(m.image as CanvasImageSource, dx, dy, m.drawW, m.drawH);
        }

        const { canvas: final, ctx: finalCtx } = this.createCanvas(tilePx);
        finalCtx.drawImage(offscreen as CanvasImageSource, -paddingPx, -paddingPx);
        return final;
    }

    private async canvasToBytes(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array | null> {
        if (canvas instanceof OffscreenCanvas) {
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            return new Uint8Array(await blob.arrayBuffer());
        }
        return new Promise<Uint8Array | null>((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) { resolve(null); return; }
                blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
            }, 'image/png');
        });
    }

    async renderTile(req: TileRequest): Promise<Uint8Array | null> {
        const key = this.tileKey(req);
        if (this.tileCache.has(key)) return this.tileCache.get(key) ?? null;

        const { x, y, z } = req;
        const tilePx = this.tileSize;
        const assumedHalfExtentPx = 32;

        let candidates = this.queryCandidates(z, x, y, assumedHalfExtentPx);
        if (candidates.length === 0) {
            this.tileCache.set(key, null);
            return null;
        }

        // Ensure icons for candidates are decoded before drawing (async path
        // can afford to wait, unlike the synchronous data-URL fallback).
        await Promise.all([...new Set(candidates.map((c) => this.bitmapIconOf(c).url))].map((url) => this.icons.ensure(url)));

        const tileOriginWx = x * tilePx;
        const tileOriginWy = y * tilePx;

        let { markers, maxHalfExtentPx } = this.prepareMarkers(candidates, tileOriginWx, tileOriginWy, z, tilePx);
        if (maxHalfExtentPx > assumedHalfExtentPx + 1) {
            candidates = this.queryCandidates(z, x, y, maxHalfExtentPx);
            await Promise.all([...new Set(candidates.map((c) => this.bitmapIconOf(c).url))].map((url) => this.icons.ensure(url)));
            ({ markers, maxHalfExtentPx } = this.prepareMarkers(candidates, tileOriginWx, tileOriginWy, z, tilePx));
        }

        if (markers.length === 0) {
            this.tileCache.set(key, null);
            return null;
        }

        const paddingPx = Math.max(Math.ceil(maxHalfExtentPx + 2), 2);
        const finalCanvas = this.draw(markers, tilePx, paddingPx);
        const bytes = await this.canvasToBytes(finalCanvas);
        this.tileCache.set(key, bytes);
        return bytes;
    }

    /**
     * Synchronous best-effort render for APIs that require a data: URL
     * immediately (e.g. Google Maps ImageMapType.getTileUrl). Markers whose
     * icon hasn't finished decoding yet are skipped for this call and
     * decoded in the background — call `preloadIcons()` first to avoid this
     * gap on first paint.
     */
    renderTileDataUrl(req: TileRequest): string | null {
        const { x, y, z } = req;
        const tilePx = this.tileSize;
        const assumedHalfExtentPx = 32;

        const candidates = this.queryCandidates(z, x, y, assumedHalfExtentPx);
        if (candidates.length === 0) return null;
        this.warmIcons(candidates);

        const tileOriginWx = x * tilePx;
        const tileOriginWy = y * tilePx;
        const { markers, maxHalfExtentPx } = this.prepareMarkers(candidates, tileOriginWx, tileOriginWy, z, tilePx);
        if (markers.length === 0) return null;

        const paddingPx = Math.max(Math.ceil(maxHalfExtentPx + 2), 2);
        const finalCanvas = this.draw(markers, tilePx, paddingPx);
        return finalCanvas instanceof HTMLCanvasElement ? finalCanvas.toDataURL('image/png') : null;
    }

    /**
     * Serialize items + deduped icon bitmaps for transfer to the Service
     * Worker, so tiles can be rendered with OffscreenCanvas without a
     * main-thread round-trip. Icons are decoded (async) and deduplicated by
     * BitmapIcon.url so identical icons are only transferred once.
     *
     * `zoomScales` mirrors the original design: computed from a representative
     * item, since `iconScaleCallback` is usually zoom-only in practice. Items
     * whose icon could not be decoded to an ImageBitmap (SW contexts have no
     * <img>) fall back to the default icon's index rather than being dropped,
     * so they still render (as the default icon) instead of silently vanishing.
     */
    async toSWData(): Promise<{
        items: { lat: number; lng: number; iconIndex: number }[];
        icons: { bitmap: ImageBitmap; anchor: { x: number; y: number }; size: { width: number; height: number } }[];
        zoomScales: number[];
        extraIconScale: number;
    }> {
        const iconIndexByUrl = new Map<string, number>();
        const icons: { bitmap: ImageBitmap; anchor: { x: number; y: number }; size: { width: number; height: number } }[] = [];
        const items: { lat: number; lng: number; iconIndex: number }[] = [];

        const resolveIconIndex = async (bitmapIcon: BitmapIcon): Promise<number | null> => {
            const cached = iconIndexByUrl.get(bitmapIcon.url);
            if (cached !== undefined) return cached;
            const decoded = await this.icons.ensure(bitmapIcon.url);
            if (!decoded || !(typeof ImageBitmap !== 'undefined' && decoded instanceof ImageBitmap)) {
                return null;
            }
            const index = icons.length;
            iconIndexByUrl.set(bitmapIcon.url, index);
            icons.push({ bitmap: decoded, anchor: bitmapIcon.anchor, size: bitmapIcon.size });
            return index;
        };

        const defaultIconIndex = await resolveIconIndex(this.defaultBitmapIcon);

        for (const item of this.items) {
            const bitmapIcon = this.bitmapIconOf(item);
            const iconIndex = (await resolveIconIndex(bitmapIcon)) ?? defaultIconIndex;
            if (iconIndex === null) continue; // even the default icon failed to decode; nothing drawable
            items.push({ lat: item.position.latitude, lng: item.position.longitude, iconIndex });
        }

        const representative = this.items[0];
        const zoomScales = Array.from({ length: 23 }, (_, z) =>
            representative ? Math.max(this.iconScale(representative, z), 0) : defaultIconScale(z),
        );

        if (this.items.length > 0 && items.length === 0) {
            console.warn(
                '[MapConductor] MarkerTileRenderer.toSWData: all',
                this.items.length,
                'marker(s) were dropped (icon decode failed, including the default icon) — SW-side tiles will render empty',
            );
        } else {
            console.debug(
                '[MapConductor] MarkerTileRenderer.toSWData: items=', items.length,
                'icons=', icons.length,
            );
        }

        return { items, icons, zoomScales, extraIconScale: this.extraIconScale };
    }

    /**
     * Find the nearest item to `click` within `hitRadiusPx` pixels at the given zoom level.
     *
     * Use `MARKER_HIT_RADIUS_TOUCH_PX` for finger taps and `MARKER_HIT_RADIUS_MOUSE_PX`
     * for mouse/pen, or supply a custom radius. Returns `null` when nothing is close enough.
     */
    findNearest(click: GeoPoint, hitRadiusPx: number, zoom: number): T | null {
        const metersPerPx =
            (156543.03392 * Math.cos((click.latitude * Math.PI) / 180)) / Math.pow(2, zoom);
        const clickRadiusDeg = (hitRadiusPx * metersPerPx) / 111111;
        const threshold = clickRadiusDeg * clickRadiusDeg;

        const candidates = this.grid.queryBounds(
            click.latitude - clickRadiusDeg,
            click.latitude + clickRadiusDeg,
            click.longitude - clickRadiusDeg,
            click.longitude + clickRadiusDeg,
        );

        let nearest: T | null = null;
        let minDist = Infinity;

        for (const item of candidates) {
            const { position } = item;
            const dlat = position.latitude - click.latitude;
            const dlng = position.longitude - click.longitude;
            const d = dlat * dlat + dlng * dlng;
            if (d < threshold && d < minDist) {
                minDist = d;
                nearest = item;
            }
        }
        return nearest;
    }
}
