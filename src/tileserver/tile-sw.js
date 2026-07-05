// Service Worker: intercepts /__tiles/ requests and renders tiles.
//
// Primary path: SW-side OffscreenCanvas rendering (no main-thread round-trip).
//   The main thread sends marker data via postMessage on register/unregister.
//   This avoids all clientId issues (e.g. Google Maps fetching tiles from a worker).
//
// Fallback path: postMessage to main thread (for providers without SW-side data,
// or browsers that do not support OffscreenCanvas in Service Workers).

// 1x1 transparent PNG for empty tiles
const EMPTY_TILE = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 11, 73, 68, 65, 84, 8, 215, 99, 96, 0, 2, 0, 0, 5, 0, 1, 226, 38, 5, 155,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/**
 * SW-side provider data registered by the main thread:
 * routeId -> { items: [{lat,lng,iconIndex}], icons: [{bitmap,anchor,size}], zoomScales, extraIconScale, grid }
 * `icons[].bitmap` are transferred ImageBitmaps (see MarkerTileRenderer.toSWData()),
 * decoded once on the main thread and deduplicated by icon content.
 */
const swProviders = new Map();

const GRID_CELL_DEG = 0.02;
const GRID_MAX_CELLS_PER_QUERY = 4000;

function buildGrid(items) {
    const cells = new Map();
    for (const item of items) {
        const cx = Math.floor(item.lng / GRID_CELL_DEG);
        const cy = Math.floor(item.lat / GRID_CELL_DEG);
        const key = cx + ':' + cy;
        const bucket = cells.get(key);
        if (bucket) bucket.push(item);
        else cells.set(key, [item]);
    }
    return cells;
}

function queryGrid(grid, items, south, north, west, east) {
    const cx0 = Math.floor(west / GRID_CELL_DEG);
    const cx1 = Math.floor(east / GRID_CELL_DEG);
    const cy0 = Math.floor(south / GRID_CELL_DEG);
    const cy1 = Math.floor(north / GRID_CELL_DEG);
    const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

    if (!Number.isFinite(cellCount) || cellCount > GRID_MAX_CELLS_PER_QUERY) {
        return items.filter((it) => it.lat >= south && it.lat <= north && it.lng >= west && it.lng <= east);
    }

    const out = [];
    for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
            const bucket = grid.get(cx + ':' + cy);
            if (!bucket) continue;
            for (const it of bucket) {
                if (it.lat >= south && it.lat <= north && it.lng >= west && it.lng <= east) out.push(it);
            }
        }
    }
    return out;
}

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'sw-register') {
        swProviders.set(msg.routeId, {
            items: msg.items,
            icons: msg.icons,
            zoomScales: msg.zoomScales,
            extraIconScale: msg.extraIconScale ?? 1.0,
            grid: buildGrid(msg.items),
        });
        console.log('[tile-sw] sw-register:', msg.routeId, 'items:', msg.items.length, 'icons:', msg.icons.length);
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
        }
    } else if (msg.type === 'sw-unregister') {
        swProviders.delete(msg.routeId);
        console.log('[tile-sw] sw-unregister:', msg.routeId);
    }
});

// pathname: /__tiles/{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}.png
function parseTileUrl(pathname) {
    const m = pathname.match(/^\/__tiles\/([^/]+)\/(\d+)\/(?:[^/]+\/)?(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!m) return null;
    return { routeId: m[1], tileSize: +m[2], z: +m[3], x: +m[4], y: +m[5] };
}

function toWorldPixel(lat, lng, z) {
    const scale = 256 * Math.pow(2, z);
    const wx = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { wx, wy };
}

function tileToGeoBounds(x, y, z, tileSize) {
    const n = Math.pow(2, z);
    const tilesPerWorld = (256 / tileSize) * n;
    const west = (x / tilesPerWorld) * 360 - 180;
    const east = ((x + 1) / tilesPerWorld) * 360 - 180;
    const latRad = (yy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / tilesPerWorld)));
    const north = (latRad(y) * 180) / Math.PI;
    const south = (latRad(y + 1) * 180) / Math.PI;
    return { north, south, west, east };
}

function canRenderOffscreen() {
    if (typeof OffscreenCanvas === 'undefined') return false;
    // Some browsers expose OffscreenCanvas but not convertToBlob (e.g. older Android WebView).
    try {
        return typeof new OffscreenCanvas(1, 1).convertToBlob === 'function';
    } catch {
        return false;
    }
}

function queryCandidates(provider, x, y, z, tileSize, paddingPx) {
    const { north, south, west, east } = tileToGeoBounds(x, y, z, tileSize);
    const latSpan = north - south;
    const lonSpan = east - west || 1e-9;
    const padNorm = paddingPx / tileSize;
    return queryGrid(
        provider.grid,
        provider.items,
        south - latSpan * padNorm,
        north + latSpan * padNorm,
        west - lonSpan * padNorm,
        east + lonSpan * padNorm,
    );
}

function prepareMarkers(provider, candidates, tileOriginX, tileOriginY, z, tilePx) {
    const zoomScales = provider.zoomScales;
    const zoomScale = zoomScales ? (zoomScales[Math.min(22, Math.floor(z))] ?? 1.0) : 1.0;
    const scale = Math.max(zoomScale * provider.extraIconScale, 0);

    let maxHalfExtentPx = 0;
    const markers = [];

    for (const item of candidates) {
        const icon = provider.icons[item.iconIndex];
        if (!icon) continue;

        const { wx, wy } = toWorldPixel(item.lat, item.lng, z);
        const centerX = wx - tileOriginX;
        const centerY = wy - tileOriginY;
        if (centerX < -tilePx || centerX > 2 * tilePx || centerY < -tilePx || centerY > 2 * tilePx) continue;

        const drawW = Math.max(icon.size.width * scale, 1);
        const drawH = Math.max(icon.size.height * scale, 1);
        const anchorX = icon.anchor.x;
        const anchorY = icon.anchor.y;
        const halfX = Math.max(Math.abs(drawW * anchorX), Math.abs(drawW * (1 - anchorX)));
        const halfY = Math.max(Math.abs(drawH * anchorY), Math.abs(drawH * (1 - anchorY)));
        maxHalfExtentPx = Math.max(maxHalfExtentPx, halfX, halfY);

        markers.push({ bitmap: icon.bitmap, centerX, centerY, drawW, drawH, anchorX, anchorY });
    }

    return { markers, maxHalfExtentPx };
}

async function renderOffscreen(provider, x, y, z, tileSize) {
    const tileOriginX = x * tileSize;
    const tileOriginY = y * tileSize;
    const assumedHalfExtentPx = 32;

    let candidates = queryCandidates(provider, x, y, z, tileSize, assumedHalfExtentPx);
    if (candidates.length === 0) {
        if (provider.items.length > 0) {
            console.debug('[tile-sw] no candidates in bounds for z=' + z + ' x=' + x + ' y=' + y, 'totalItems:', provider.items.length);
        }
        return null;
    }

    let { markers, maxHalfExtentPx } = prepareMarkers(provider, candidates, tileOriginX, tileOriginY, z, tileSize);
    if (maxHalfExtentPx > assumedHalfExtentPx + 1) {
        candidates = queryCandidates(provider, x, y, z, tileSize, maxHalfExtentPx);
        ({ markers, maxHalfExtentPx } = prepareMarkers(provider, candidates, tileOriginX, tileOriginY, z, tileSize));
    }
    if (markers.length === 0) {
        console.debug('[tile-sw] candidates found but 0 markers prepared for z=' + z + ' x=' + x + ' y=' + y, 'candidates:', candidates.length, 'icons registered:', provider.icons.length);
        return null;
    }

    const paddingPx = Math.max(Math.ceil(maxHalfExtentPx + 2), 2);
    const offscreenSize = tileSize + paddingPx * 2;
    const canvas = new OffscreenCanvas(offscreenSize, offscreenSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    for (const m of markers) {
        const cx = m.centerX + paddingPx;
        const cy = m.centerY + paddingPx;
        ctx.drawImage(m.bitmap, cx - m.drawW * m.anchorX, cy - m.drawH * m.anchorY, m.drawW, m.drawH);
    }

    const finalCanvas = new OffscreenCanvas(tileSize, tileSize);
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) return null;
    finalCtx.drawImage(canvas, -paddingPx, -paddingPx);

    const blob = await finalCanvas.convertToBlob({ type: 'image/png' });
    if (!blob || blob.size === 0) {
        console.warn('[tile-sw] convertToBlob returned empty blob for tile', x, y, z);
        return null;
    }
    return blob;
}

async function findWindowClient(clientId) {
    if (clientId) {
        const client = await self.clients.get(clientId);
        if (client && client.type === 'window') return client;
    }
    const windows = await self.clients.matchAll({ type: 'window' });
    return windows.find((c) => c.focused) ?? windows[0] ?? null;
}

function emptyTileResponse() {
    return new Response(EMPTY_TILE, { headers: { 'Content-Type': 'image/png' } });
}

function pngResponse(body) {
    // No Access-Control-Allow-Origin: this response only ever satisfies a
    // same-origin fetch to /__tiles/ intercepted by this page's own SW, so
    // the header is meaningless here — leaving it out avoids implying an
    // intentional cross-origin allowance that doesn't actually apply.
    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300',
        },
    });
}

function postMessageRender(client, pathname) {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            resolve(emptyTileResponse());
        }, 5000);

        channel.port1.onmessage = (e) => {
            clearTimeout(timeout);
            const result = e.data.result;
            if (result) {
                resolve(pngResponse(result));
            } else {
                resolve(emptyTileResponse());
            }
        };

        client.postMessage({ type: 'tile-request', pathname }, [channel.port2]);
    });
}

async function mainThreadRender(pathname, clientId) {
    const client = await findWindowClient(clientId);
    if (!client) return emptyTileResponse();
    return postMessageRender(client, pathname);
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith('/__tiles/')) return;

    const parsed = parseTileUrl(url.pathname);
    if (!parsed) return;

    const { routeId, tileSize, x, y, z } = parsed;
    const swProvider = swProviders.get(routeId);
    const offscreenOk = canRenderOffscreen();
    console.log('[tile-sw] fetch z=' + z + ' x=' + x + ' y=' + y, 'swProvider:', !!swProvider, 'offscreen:', offscreenOk, 'clientId:', event.clientId);

    if (swProvider && offscreenOk) {
        event.respondWith(
            renderOffscreen(swProvider, x, y, z, tileSize)
                .then((blob) => {
                    // console.log('[tile-sw] offscreen result blob:', blob ? blob.size : 'null', 'for z=' + z + ' x=' + x + ' y=' + y);
                    return blob ? pngResponse(blob) : emptyTileResponse();
                })
                .catch((err) => {
                    console.warn('[tile-sw] offscreen failed, falling back to postMessage:', err);
                    return mainThreadRender(url.pathname, event.clientId);
                }),
        );
    } else {
        event.respondWith(mainThreadRender(url.pathname, event.clientId));
    }
});
