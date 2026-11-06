import { copyIconBitmap } from './swIconBitmaps';
import { MARKER_HIT_SEARCH_RADIUS_PX, pickMarkerHit, type MarkerHit } from './MarkerHitPick';
import { markerHitShape } from './MarkerIconExtent';
import type { TileProvider } from '../tileserver/TileProvider';
import type { TileRequest } from '../tileserver/TileRequest';
import type { GeoPoint } from '../features';
import type { MarkerIcon } from './MarkerIcon';
import type { BitmapIcon } from './MarkerOverlayRenderer';
// android-sdk（LruCache）/ ios-sdk（NSCache.totalCostLimit）相当の上限。1 renderer は
// 1 sync ごとに作り直されるが、単一 sync でのパンによる無制限蓄積を防ぐ。
const TILE_CACHE_MAX = 1024;
import { createDefaultIcon } from './ColorDefaultIcon';
import { GeoGridIndex } from './GeoGridIndex';
import { IconImageCache } from './IconImageCache';
import type { PreparedLabel, PreparedMarker } from './MarkerTileTypes';
import { tilePartsOf, type MarkerTileLabel } from './MarkerTileLabel';

function toWorldPixel(lat: number, lng: number, z: number): { wx: number; wy: number } {
    const scale = 256 * Math.pow(2, z);
    const wx = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { wx, wy };
}

function tileToGeoBounds(x: number, y: number, z: number, tileSize: number, paddingPx = 0): {
    north: number; south: number; west: number; east: number;
} {
    const n = Math.pow(2, z);
    const tilesPerWorld = (256 / tileSize) * n; // in case tileSize !== 256, keep it in "256-equivalent" tile units
    const pad = paddingPx / tileSize;
    const west = ((x - pad) / tilesPerWorld) * 360 - 180;
    const east = ((x + 1 + pad) / tilesPerWorld) * 360 - 180;
    const latRad = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tilesPerWorld)));
    const north = (latRad(y - pad) * 180) / Math.PI;
    const south = (latRad(y + 1 + pad) * 180) / Math.PI;
    return { north, south, west, east };
}

/** 本体の画像と、あればラベル。ラベルを分けて描けないアイコンは焼き込みの画像だけ。 */
interface TileParts {
    body: BitmapIcon;
    label: MarkerTileLabel | null;
}

/**
 * アンカー点から、本体とラベルを合わせた矩形の各辺までの距離（倍率を掛けた px）。
 * タイルの外にあるかの判定と、隣のタイルからはみ出す分の見積もりに使う。
 */
function partsExtent(parts: TileParts, scale: number): { left: number; right: number; top: number; bottom: number } {
    const { width, height } = markerTileDrawSize(parts.body, scale);
    let left = width * parts.body.anchor.x;
    let right = width * (1 - parts.body.anchor.x);
    let top = height * parts.body.anchor.y;
    let bottom = height * (1 - parts.body.anchor.y);
    const label = parts.label;
    if (label) {
        left = Math.max(left, (label.width / 2 - label.centerOffsetX) * scale);
        right = Math.max(right, (label.centerOffsetX + label.width / 2) * scale);
        top = Math.max(top, (label.height / 2 - label.centerOffsetY) * scale);
        bottom = Math.max(bottom, (label.centerOffsetY + label.height / 2) * scale);
    }
    return { left, right, top, bottom };
}

function markerTileDrawSize(bitmapIcon: BitmapIcon, scale: number): { width: number; height: number } {
    // android-sdk / ios-sdk と一致: baked bitmap のサイズ × scale をそのまま使う
    // （以前は最大辺を MarkerIconSize.Small(32)*scale に再正規化しており、非 32px
    //  アイコンのタイル表示サイズが native と食い違っていた）。
    return {
        width: Math.max(bitmapIcon.size.width * scale, 1),
        height: Math.max(bitmapIcon.size.height * scale, 1),
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
    readonly extraIconScale: number;
    private readonly iconScale: (item: T, zoom: number) => number;
    private readonly debugTileOverlay: boolean;
    /** Keep one marker per cell of this many pixels, or 0 to keep them all. */
    private readonly declutterPx: number;
    private readonly grid: GeoGridIndex<T>;
    private readonly icons: IconImageCache;
    /** Device pixels per CSS pixel the icons are decoded at (and the default for requests without one). */
    readonly pixelRatio: number;
    private readonly defaultBitmapIcon: BitmapIcon = createDefaultIcon().toBitmapIcon();
    /** Per-instance tile output cache; each sync creates a fresh renderer instance, so no invalidation is needed. */
    private readonly tileCache = new Map<string, Uint8Array | null>();
    // Like tileCache, these bounds belong to one immutable rendering snapshot.
    private readonly queryPaddingByZoom = new Map<number, number>();

    // android-sdk / ios-sdk の MarkerTileRenderer と同じく位置引数で受ける
    // （名前付きオプション型は持たない）。
    constructor(
        private readonly items: ReadonlyArray<T>,
        tileSize: number = 256,
        iconScaleCallback?: (item: T, zoom: number) => number,
        extraIconScale: number = 1.0,
        debugTileOverlay: boolean = false,
        declutterPx: number = 0,
        pixelRatio: number = 1,
    ) {
        this.tileSize = tileSize;
        this.pixelRatio = pixelRatio;
        this.icons = new IconImageCache(pixelRatio);
        this.declutterPx = declutterPx;
        this.iconScale = iconScaleCallback ?? ((_item, _zoom) => 1.0);
        this.extraIconScale = extraIconScale;
        this.debugTileOverlay = debugTileOverlay;
        this.grid = new GeoGridIndex(items);
    }

    private bitmapIconOf(item: T): BitmapIcon {
        return item.icon?.toBitmapIcon() ?? this.defaultBitmapIcon;
    }

    /**
     * タイルに描くもの。ラベルを分けて渡せるアイコンなら本体とラベル、それ以外は焼き込みの画像。
     * 当たり判定（`findHit`）はラベル込みの `bitmapIconOf` を使う。
     */
    private partsOf(item: T): TileParts {
        return tilePartsOf(item.icon) ?? { body: this.bitmapIconOf(item), label: null };
    }

    private urlsOf(parts: TileParts): string[] {
        return parts.label ? [parts.body.url, parts.label.url] : [parts.body.url];
    }

    /** Decode every unique icon up front. Call before relying on the synchronous renderTileDataUrl() path. */
    async preloadIcons(): Promise<void> {
        const urls = new Set<string>();
        for (const item of this.items) for (const url of this.urlsOf(this.partsOf(item))) urls.add(url);
        await Promise.all([...urls].map((url) => this.icons.ensure(url)));
    }

    private tileKey(req: TileRequest): string {
        return `${req.z}/${req.x}/${req.y}@${this.ratioOf(req)}`;
    }

    private ratioOf(req: TileRequest): number {
        return req.pixelRatio ?? this.pixelRatio;
    }

    private cacheTile(key: string, value: Uint8Array | null): void {
        this.tileCache.set(key, value);
        while (this.tileCache.size > TILE_CACHE_MAX) {
            const oldest = this.tileCache.keys().next().value;
            if (oldest === undefined) break;
            this.tileCache.delete(oldest);
        }
    }

    private queryCandidates(z: number, x: number, y: number, paddingPx: number): T[] {
        // A whole declutter cell beyond the icon overhang.
        //
        // The overhang alone is enough to draw the tile, but not enough to
        // decide it: a declutter cell straddling the edge would have some of
        // its markers inside the query and some outside, and the tile next door
        // would see a different part of the same cell. Both would keep a marker
        // and the two would not be the same one, which is an icon cut at the
        // seam. Growing by the cell as well means every cell that reaches this
        // tile is here in full, so both tiles see all of it and agree.
        const tile = tileToGeoBounds(x, y, z, this.tileSize);
        const { north, south, west, east } =
            tileToGeoBounds(x, y, z, this.tileSize, paddingPx + this.declutterPx);

        // With declutter on, thin at the index rather than after.
        //
        // The caller is about to keep one marker per `declutterPx` cell anyway,
        // so every marker it will drop is one the index need not have returned
        // — and on a dense layer that is most of them. Positioning and decoding
        // the ones destined for the bin is what made declutter *cost* time on
        // the other two SDKs before they moved the thinning here (20,000
        // markers, 82.8 ms to 178.5 ms on iOS).
        //
        // The index declines when its cells cannot guarantee the separation, in
        // which case this falls back to the full query and the later pass does
        // the thinning as before. The separation is read off the tile itself,
        // not the padded box, so it does not depend on the icons.
        const latSpan = tile.north - tile.south;
        const lonSpan = tile.east - tile.west || 1e-9;
        const separationDegrees =
            this.declutterPx > 0 ? (Math.max(latSpan, lonSpan) * this.declutterPx) / this.tileSize : 0;
        if (separationDegrees > 0) {
            const thinned = this.grid.queryBoundsThinned(south, north, west, east, separationDegrees);
            if (thinned) return thinned;
        }
        return this.grid.queryBounds(south, north, west, east);
    }

    private queryPaddingPx(z: number): number {
        const cached = this.queryPaddingByZoom.get(z);
        if (cached !== undefined) return cached;
        // Determine the bound BEFORE the spatial query. Expanding from the first
        // candidates misses a large icon whose anchor lies outside that query.
        // Cache once per zoom, rather than scanning all markers for every tile.
        // ラベルも含める。隣のタイルの点のラベルがこのタイルへはみ出してくると、それを
        // 探し漏らしたタイルの側でラベルが継ぎ目で切れる。
        const partsByIcon = new Map<MarkerIcon, TileParts>();
        const defaultParts: TileParts = { body: this.defaultBitmapIcon, label: null };
        let extent = 0;
        for (const item of this.items) {
            let parts = defaultParts;
            if (item.icon) {
                parts = partsByIcon.get(item.icon) ?? this.partsOf(item);
                partsByIcon.set(item.icon, parts);
            }
            const scale = Math.max(Math.max(this.iconScale(item, z), 0) * this.extraIconScale, 0);
            const { left, right, top, bottom } = partsExtent(parts, scale);
            extent = Math.max(extent, left, right, top, bottom);
        }
        const padding = Math.ceil(extent) + 2;
        this.queryPaddingByZoom.set(z, padding);
        return padding;
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
            const parts = this.partsOf(item);
            const bitmapIcon = parts.body;
            const image = this.icons.get(bitmapIcon.url);
            if (!image) continue; // not decoded yet; skip for this render (self-heals once cached)
            const labelImage = parts.label ? this.icons.get(parts.label.url) : null;

            const { wx, wy } = toWorldPixel(item.position.latitude, item.position.longitude, z);
            const centerNormX = wx - tileOriginWx;
            const centerNormY = wy - tileOriginWy;

            const callbackScale = Math.max(this.iconScale(item, z), 0);
            const scale = Math.max(callbackScale * this.extraIconScale, 0);
            const drawSize = markerTileDrawSize(bitmapIcon, scale);
            const drawW = drawSize.width;
            const drawH = drawSize.height;
            const anchorX = bitmapIcon.anchor.x;
            const anchorY = bitmapIcon.anchor.y;
            const extent = partsExtent(parts, scale);
            if (centerNormX - extent.left > tilePx || centerNormX + extent.right < 0 ||
                centerNormY - extent.top > tilePx || centerNormY + extent.bottom < 0) continue;

            maxHalfExtentPx = Math.max(maxHalfExtentPx, extent.left, extent.right, extent.top, extent.bottom);

            let label: PreparedLabel | null = null;
            if (parts.label && labelImage) {
                label = {
                    image: labelImage,
                    centerOffsetX: parts.label.centerOffsetX * scale,
                    centerOffsetY: parts.label.centerOffsetY * scale,
                    drawW: Math.max(parts.label.width * scale, 1),
                    drawH: Math.max(parts.label.height * scale, 1),
                };
            }
            markers.push({ image, centerNormX, centerNormY, drawW, drawH, anchorX, anchorY, label });
        }

        return { markers, maxHalfExtentPx };
    }

    /** Kick off (but don't await) decoding for any candidate not yet in the icon cache. */
    private warmIcons(candidates: T[]): void {
        for (const item of candidates) {
            for (const url of this.urlsOf(this.partsOf(item))) {
                if (!this.icons.get(url)) void this.icons.ensure(url);
            }
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

    private draw(
        markers: PreparedMarker[],
        tilePx: number,
        paddingPx: number,
        req: TileRequest,
        tileOriginWx: number,
        tileOriginWy: number,
    ): OffscreenCanvas | HTMLCanvasElement {
        // Positions are worked out in CSS pixels, as at 1x; only the canvas and
        // the final placement are multiplied, and rounding comes after that so
        // markers land on whole device pixels.
        const r = this.ratioOf(req);
        const offscreenSize = (tilePx + paddingPx * 2) * r;
        const { canvas: offscreen, ctx: offCtx } = this.createCanvas(offscreenSize);
        // Drop markers completely hidden by a later one.
        //
        // Zoom out far enough and a whole city collapses onto a few hundred
        // pixels: at z6 a dataset of 20k markers resolves to a couple of
        // thousand distinct positions, and the rest are drawn underneath copies
        // of themselves. Keeping the last of each group is what would have been
        // visible anyway, since drawing is in painter's order.
        //
        // Only exact agreement counts — same rectangle, same icon — so nothing
        // that could peek out from behind another is dropped. Where markers
        // share a rectangle but not an icon, none are: a different icon may be
        // transparent where the one above it is not.
        const lastAt = new Map<string, number>();
        const mixedIcons = new Set<string>();
        const placed = markers.map((m) => {
            const centerX = m.centerNormX + paddingPx;
            const centerY = m.centerNormY + paddingPx;
            // Whole pixels, deliberately. The destination comes out of a
            // projection, so it lands on a fraction of a pixel almost every
            // time, and drawing to a non-integer destination makes the canvas
            // resample: 20k markers measured at 277 ms unaligned against 38 ms
            // aligned in Chromium, and the same effect costs 20x on Android.
            // Rounding moves a pin by at most half a pixel, which is not
            // visible at icon scale.
            return {
                image: m.image as CanvasImageSource,
                dx: Math.round((centerX - m.drawW * m.anchorX) * r),
                dy: Math.round((centerY - m.drawH * m.anchorY) * r),
                w: Math.max(1, Math.round(m.drawW * r)),
                h: Math.max(1, Math.round(m.drawH * r)),
                worldX: m.centerNormX + tileOriginWx,
                worldY: m.centerNormY + tileOriginWy,
                // 書き出し位置は整数の画素に揃える。境界をまたぐラベルを両側のタイルが
                // 同じ画素から描くので、継ぎ目で字が割れない。
                label: m.label
                    ? {
                        image: m.label.image as CanvasImageSource,
                        dx: Math.round((centerX + m.label.centerOffsetX - m.label.drawW / 2) * r),
                        dy: Math.round((centerY + m.label.centerOffsetY - m.label.drawH / 2) * r),
                        w: Math.max(1, Math.round(m.label.drawW * r)),
                        h: Math.max(1, Math.round(m.label.drawH * r)),
                    }
                    : null,
            };
        });

        // With decluttering on the group is a cell rather than a rectangle, and
        // the mixed-icon exemption does not apply: the caller has said markers
        // that close together are interchangeable, so one of them stands for
        // the rest whatever they draw.
        // The declutter cell is anchored to the world, not to this tile.
        //
        // `dx`/`dy` are positions within this tile, so a cell keyed off them
        // moves with the tile: the same ground lands in a different cell on the
        // tile next door, the two tiles keep different markers, and a marker
        // drawn on one and dropped on the other is **cut at the seam.** Adding
        // the tile's own origin back gives the world pixel the projection
        // produced, which is the same number whichever tile is asking.
        //
        // Subtracting the tile's own cell keeps the numbers small. That does
        // not move the grid — two tiles still agree about which markers share a
        // cell, which is all the grouping is asked for — and android-sdk needs
        // the small numbers, because it packs the group and an index into one
        // Long. The three stay identical.
        const declutter = this.declutterPx > 0;
        const cell = Math.max(this.declutterPx, 1);
        const baseCellX = Math.floor(tileOriginWx / cell);
        const baseCellY = Math.floor(tileOriginWy / cell);
        const groupKey = (p: {
            dx: number;
            dy: number;
            w: number;
            h: number;
            worldX: number;
            worldY: number;
        }): string =>
            declutter
                ? `${Math.floor(p.worldX / cell) - baseCellX},${Math.floor(p.worldY / cell) - baseCellY}`
                : `${p.dx},${p.dy},${p.w},${p.h}`;

        // ラベル付きを先に残す。ラベルは利用者が「この点の名前を見せたい」と選んだもので、
        // 同じマス目の点のどれかと入れ替えてよいものではない。ラベル付きどうしは世界座標
        // （worldY 優先、次に worldX）で決める。列挙順はタイルごとに違うので、順番で決めると
        // 隣のタイルと別の勝者を選び、境界でラベルが割れる。android-sdk / ios-sdk と同じ。
        const worldKey = (p: { worldX: number; worldY: number }): number => p.worldY * 1_048_576 + p.worldX;
        const labelledWinner = new Map<string, number>();
        const seenIcon = new Map<string, CanvasImageSource>();
        for (let index = 0; index < placed.length; index++) {
            const p = placed[index];
            const key = groupKey(p);
            if (!declutter) {
                const previous = seenIcon.get(key);
                // 本体が同じでも文字が違えば重ねたまま描く（間引きなしのとき）。
                if (previous !== undefined && (previous !== p.image || p.label || placed[lastAt.get(key) ?? index].label)) {
                    mixedIcons.add(key);
                }
                seenIcon.set(key, p.image);
            }
            lastAt.set(key, index);
            if (p.label) {
                const winner = labelledWinner.get(key);
                if (winner === undefined || worldKey(p) > worldKey(placed[winner])) labelledWinner.set(key, index);
            }
        }

        const drawn: boolean[] = placed.map((p, index) => {
            const key = groupKey(p);
            const winner = labelledWinner.get(key);
            if (declutter && winner !== undefined) return winner === index;
            return mixedIcons.has(key) || lastAt.get(key) === index;
        });
        for (let index = 0; index < placed.length; index++) {
            if (!drawn[index]) continue;
            const p = placed[index];
            offCtx.drawImage(p.image, p.dx, p.dy, p.w, p.h);
        }
        // 文字は本体をすべて描いたあと。ほかの点の下に字が隠れない。
        for (let index = 0; index < placed.length; index++) {
            const label = drawn[index] ? placed[index].label : null;
            if (label) offCtx.drawImage(label.image, label.dx, label.dy, label.w, label.h);
        }

        // android-sdk / ios-sdk と同じデバッグオーバーレイ：padding 位置に上/左の枠線と
        // タイル座標・マーカー数のラベルを赤で描画する。
        if (this.debugTileOverlay) {
            offCtx.save();
            offCtx.scale(r, r);
            this.drawDebugOverlay(offCtx, tilePx, paddingPx, req, markers.length);
            offCtx.restore();
        }

        const { canvas: final, ctx: finalCtx } = this.createCanvas(tilePx * r);
        finalCtx.drawImage(offscreen as CanvasImageSource, -paddingPx * r, -paddingPx * r);
        return final;
    }

    private drawDebugOverlay(
        ctx: CanvasRenderingContext2D,
        tilePx: number,
        paddingPx: number,
        req: TileRequest,
        entries: number,
    ): void {
        const o = paddingPx;
        ctx.save();
        ctx.strokeStyle = '#FF0000';
        ctx.fillStyle = '#FF0000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(o, o);
        ctx.lineTo(o + tilePx, o);
        ctx.moveTo(o, o);
        ctx.lineTo(o, o + tilePx);
        ctx.stroke();
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`x/y/z=${req.x}/${req.y}/${req.z}, entries=${entries}`, o + 20, o + 20);
        ctx.restore();
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
        const candidates = this.queryCandidates(z, x, y, this.queryPaddingPx(z));
        if (candidates.length === 0) {
            this.cacheTile(key, null);
            return null;
        }

        // Ensure icons for candidates are decoded before drawing (async path
        // can afford to wait, unlike the synchronous data-URL fallback).
        await Promise.all([...new Set(candidates.flatMap((c) => this.urlsOf(this.partsOf(c))))].map((url) => this.icons.ensure(url)));

        const tileOriginWx = x * tilePx;
        const tileOriginWy = y * tilePx;

        const { markers, maxHalfExtentPx } = this.prepareMarkers(candidates, tileOriginWx, tileOriginWy, z, tilePx);

        if (markers.length === 0) {
            this.cacheTile(key, null);
            return null;
        }

        const paddingPx = Math.max(Math.ceil(maxHalfExtentPx + 2), 2);
        const finalCanvas = this.draw(markers, tilePx, paddingPx, req, tileOriginWx, tileOriginWy);
        const bytes = await this.canvasToBytes(finalCanvas);
        this.cacheTile(key, bytes);
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
        const candidates = this.queryCandidates(z, x, y, this.queryPaddingPx(z));
        if (candidates.length === 0) return null;
        this.warmIcons(candidates);

        const tileOriginWx = x * tilePx;
        const tileOriginWy = y * tilePx;
        const { markers, maxHalfExtentPx } = this.prepareMarkers(candidates, tileOriginWx, tileOriginWy, z, tilePx);
        if (markers.length === 0) return null;

        const paddingPx = Math.max(Math.ceil(maxHalfExtentPx + 2), 2);
        const finalCanvas = this.draw(markers, tilePx, paddingPx, req, tileOriginWx, tileOriginWy);
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
     *
     * The returned bitmaps belong to the caller, who must release them with
     * `closeSWIcons()` once they have been posted. `sendSWRegisterAndWait()`
     * already does this, so the usual one-line call site needs nothing extra.
     */
    async toSWData(): Promise<{
        items: { lat: number; lng: number; iconIndex: number; labelIndex: number }[];
        icons: { bitmap: ImageBitmap; anchor: { x: number; y: number }; size: { width: number; height: number } }[];
        labels: { bitmap: ImageBitmap; centerOffset: { x: number; y: number }; size: { width: number; height: number } }[];
        zoomScales: number[];
        extraIconScale: number;
        declutterPx: number;
    }> {
        const iconIndexByUrl = new Map<string, number>();
        const icons: { bitmap: ImageBitmap; anchor: { x: number; y: number }; size: { width: number; height: number } }[] = [];
        const items: { lat: number; lng: number; iconIndex: number; labelIndex: number }[] = [];
        // ラベルは本体と別に渡す（`MarkerTileLabel`）。同じ文字・同じ置き場所なら 1 枚を共有する。
        const labelIndexByKey = new Map<string, number>();
        const labels: { bitmap: ImageBitmap; centerOffset: { x: number; y: number }; size: { width: number; height: number } }[] = [];
        const resolveLabelIndex = async (label: MarkerTileLabel | null): Promise<number> => {
            if (!label) return -1;
            const key = `${label.url}|${label.centerOffsetX}|${label.centerOffsetY}`;
            const cached = labelIndexByKey.get(key);
            if (cached !== undefined) return cached;
            const decoded = await this.icons.ensure(label.url);
            if (!decoded || !(typeof ImageBitmap !== 'undefined' && decoded instanceof ImageBitmap)) {
                labelIndexByKey.set(key, -1);
                return -1;
            }
            const index = labels.length;
            labelIndexByKey.set(key, index);
            labels.push({
                bitmap: await copyIconBitmap(decoded),
                centerOffset: { x: label.centerOffsetX, y: label.centerOffsetY },
                size: { width: label.width, height: label.height },
            });
            return index;
        };

        const resolveIconIndex = async (bitmapIcon: BitmapIcon): Promise<number | null> => {
            const cached = iconIndexByUrl.get(bitmapIcon.url);
            if (cached !== undefined) return cached;
            const decoded = await this.icons.ensure(bitmapIcon.url);
            if (!decoded || !(typeof ImageBitmap !== 'undefined' && decoded instanceof ImageBitmap)) {
                return null;
            }
            // A copy, not the cache's own bitmap: the cache closes an entry as
            // soon as its LRU evicts it, and this loop runs long enough for that
            // to happen to icons already collected here. See swIconBitmaps.ts.
            const bitmap = await copyIconBitmap(decoded);
            const index = icons.length;
            iconIndexByUrl.set(bitmapIcon.url, index);
            icons.push({
                bitmap,
                anchor: bitmapIcon.anchor,
                size: markerTileDrawSize(bitmapIcon, 1.0),
            });
            return index;
        };

        const defaultIconIndex = await resolveIconIndex(this.defaultBitmapIcon);

        for (const item of this.items) {
            const parts = this.partsOf(item);
            const iconIndex = (await resolveIconIndex(parts.body)) ?? defaultIconIndex;
            if (iconIndex === null) continue; // even the default icon failed to decode; nothing drawable
            const labelIndex = await resolveLabelIndex(parts.label);
            items.push({ lat: item.position.latitude, lng: item.position.longitude, iconIndex, labelIndex });
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
                'labels=', labels.length,
            );
        }

        return { items, icons, labels, zoomScales, extraIconScale: this.extraIconScale, declutterPx: this.declutterPx };
    }

    /**
     * Find the item under `click` at the given zoom level, or the nearest one within `hitRadiusPx`.
     *
     * Use `MARKER_HIT_RADIUS_TOUCH_PX` for finger taps and `MARKER_HIT_RADIUS_MOUSE_PX`
     * for mouse/pen, or supply a custom radius. Returns `null` when nothing is close enough.
     */
    findNearest(click: GeoPoint, hitRadiusPx: number, zoom: number): T | null {
        return this.findHit(click, hitRadiusPx, zoom)?.item ?? null;
    }

    /**
     * {@link findNearest} の判定結果つき版。通常マーカーの結果と {@link preferMarkerHit} で
     * 比べるために、矩形そのものに入ったか（`exact`）と距離も返す。
     *
     * 選び方はコアの {@link pickMarkerHit} と同じ。描かれた（ラベル込みの）アイコンの矩形に
     * タップ点が入っているものを、先端の近い別のマーカーより優先する。
     *
     * @internal
     */
    findHit(click: GeoPoint, hitRadiusPx: number, zoom: number): MarkerHit<T> | null {
        const cosLat = Math.cos((click.latitude * Math.PI) / 180);
        const metersPerPx = (156543.03392 * cosLat) / Math.pow(2, zoom);
        if (!(metersPerPx > 0)) return null;
        const metersPerLatDeg = 111111;
        const metersPerLngDeg = 111111 * Math.max(cosLat, 1e-6);

        const drawSizeOf = (item: T): { drawW: number; drawH: number; bitmapIcon: BitmapIcon } => {
            const bitmapIcon = this.bitmapIconOf(item);
            const scale = Math.max(Math.max(this.iconScale(item, zoom), 0) * this.extraIconScale, 0);
            const { width: drawW, height: drawH } = markerTileDrawSize(bitmapIcon, scale);
            return { drawW, drawH, bitmapIcon };
        };

        // Pad the spatial query so no marker whose icon covers the click is excluded. Icons with a
        // label beside the pin can be much wider than `items[0]`, so never pad by less than the
        // shared search radius; the exact per-candidate test still filters.
        let maxHalfPx = Math.max(hitRadiusPx, MARKER_HIT_SEARCH_RADIUS_PX);
        if (this.items.length > 0) {
            const { drawW, drawH } = drawSizeOf(this.items[0]);
            maxHalfPx = Math.max(maxHalfPx, drawW, drawH);
        }
        const padPx = maxHalfPx + hitRadiusPx;
        const padLatDeg = (padPx * metersPerPx) / metersPerLatDeg;
        const padLngDeg = (padPx * metersPerPx) / metersPerLngDeg;

        const candidates = this.grid.queryBounds(
            click.latitude - padLatDeg,
            click.latitude + padLatDeg,
            click.longitude - padLngDeg,
            click.longitude + padLngDeg,
        );

        // Click position relative to each marker's anchor, in screen pixels (y down). The click
        // itself sits at the origin, so each anchor is placed at minus that offset.
        return pickMarkerHit(
            { x: 0, y: 0 },
            candidates,
            item => {
                const { drawW, drawH, bitmapIcon } = drawSizeOf(item);
                const dxPx = ((click.longitude - item.position.longitude) * metersPerLngDeg) / metersPerPx;
                const dyPx = ((item.position.latitude - click.latitude) * metersPerLatDeg) / metersPerPx;
                return { anchorScreen: { x: -dxPx, y: -dyPx }, ...markerHitShape(bitmapIcon, drawW, drawH) };
            },
            hitRadiusPx,
        );
    }
}
