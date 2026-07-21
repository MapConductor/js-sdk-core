import type { TileProvider } from '../tileserver/TileProvider';
import type { TileRequest } from '../tileserver/TileRequest';
import type { GeoPoint } from '../features';
import { MarkerIconSize } from '../settings';
import type { MarkerIcon } from './MarkerIcon';
import type { BitmapIcon } from './MarkerOverlayRenderer';
import { createDefaultIcon } from './DefaultMarkerIcon';
import { GeoGridIndex } from './GeoGridIndex';
import { IconImageCache } from './IconImageCache';
import type { MarkerTileRenderingOptions, PreparedMarker } from './MarkerTileTypes';

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

function markerTileDrawSize(bitmapIcon: BitmapIcon, scale: number): { width: number; height: number } {
    const sourceMaxSize = Math.max(bitmapIcon.size.width, bitmapIcon.size.height, 1);
    const targetMaxSize = MarkerIconSize.Small * scale;
    const sizeScale = targetMaxSize / sourceMaxSize;
    return {
        width: Math.max(bitmapIcon.size.width * sizeScale, 1),
        height: Math.max(bitmapIcon.size.height * sizeScale, 1),
    };
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
        this.iconScale = cb ?? ((_item, _zoom) => 1.0);
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
            const scale = Math.max(callbackScale * this.extraIconScale, 0);
            const drawSize = markerTileDrawSize(bitmapIcon, scale);
            const drawW = drawSize.width;
            const drawH = drawSize.height;
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
            icons.push({
                bitmap: decoded,
                anchor: bitmapIcon.anchor,
                size: markerTileDrawSize(bitmapIcon, 1.0),
            });
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
            representative ? Math.max(this.iconScale(representative, z), 0) : 1.0,
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
