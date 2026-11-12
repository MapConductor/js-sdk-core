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
 * routeId -> { items: [{lat,lng,iconIndex,labelIndex}], icons: [{bitmap,anchor,size}],
 *             labels: [{bitmap,centerOffset,size}], zoomScales, extraIconScale, declutterPx, grid }
 * `icons[].bitmap` are ImageBitmaps this worker owns: the main thread clones
 * them in (they are NOT in the transfer list — see LocalTileServer), decoded
 * once there and deduplicated by icon content.
 */
const swProviders = new Map();

/**
 * Rendered tiles, keyed by their URL path.
 *
 * The Cache-Control header on the response does nothing here: `respondWith`
 * intercepts ahead of the HTTP cache, so a repeat request re-rendered the tile
 * every time — measured at 105 ms per fetch of an already-drawn tile, whether
 * or not the caller asked for caching.
 *
 * Budgeted in bytes rather than entries. Counting entries is the mistake this
 * project has already made once: a byte-blind cache of a few hundred tiles is
 * tens of megabytes, and in a Service Worker there is no low-memory callback to
 * catch it.
 */
const TILE_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const tileCache = new Map();
let tileCacheBytes = 0;

function cachedTile(key) {
    const hit = tileCache.get(key);
    if (hit === undefined) return null;
    // Map preserves insertion order, so re-inserting makes this the newest and
    // the eviction loop below can just take from the front.
    tileCache.delete(key);
    tileCache.set(key, hit);
    return hit;
}

function cacheTile(key, bytes) {
    if (!bytes || bytes.byteLength === 0) return;
    // A single tile larger than the whole budget would evict everything and
    // then not fit; skip it rather than empty the cache for nothing.
    if (bytes.byteLength > TILE_CACHE_MAX_BYTES) return;
    const existing = tileCache.get(key);
    if (existing !== undefined) {
        tileCacheBytes -= existing.byteLength;
        tileCache.delete(key);
    }
    tileCache.set(key, bytes);
    tileCacheBytes += bytes.byteLength;
    while (tileCacheBytes > TILE_CACHE_MAX_BYTES) {
        const oldest = tileCache.keys().next();
        if (oldest.done) break;
        tileCacheBytes -= tileCache.get(oldest.value).byteLength;
        tileCache.delete(oldest.value);
    }
}

/** Drops a route's tiles. Its markers have changed, so they all lie. */
function dropCachedTiles(routeId) {
    const prefix = '/__tiles/' + routeId + '/';
    for (const key of Array.from(tileCache.keys())) {
        if (key.startsWith(prefix)) {
            tileCacheBytes -= tileCache.get(key).byteLength;
            tileCache.delete(key);
        }
    }
}

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

// ── Shape tiles: polygons, polylines and circles ────────────────────────────
//
// The main thread sends every tiled shape of a route once: polygons with
// 'sw-register-polygons', their rings as polyline6 strings (Google's Encoded
// Polyline at 1e-6 degrees; see js-sdk-core EncodedPolyline.ts), polylines with
// 'sw-register-polylines', one open path each, circles with
// 'sw-register-circles', a centre and a radius in metres. Here they become Web Mercator
// coordinates in [0, 1]. A polygon's outline is wound one way and its holes the
// other, so a `nonzero` fill leaves out the union of the holes without
// computing it. A route holds one kind; the index, the simplified copies, the
// tile cache and its invalidation are the same code for both.
//
// Each zoom gets its own simplified copy of a shape, built the first time a
// tile at that zoom needs it: vertices snapped to that zoom's pixel grid,
// repeats dropped, Douglas-Peucker at half a pixel (a path keeps both ends).
// A polygon smaller than a pixel is drawn as one pixel; a polyline that comes
// down to one point, as a dot as wide as the line.
//
// A polyline is stroked `strokeWidth` CSS pixels wide at every zoom, with round
// caps and joins. Candidates for a tile are looked up with the tile grown by
// half the widest stroke, and each is drawn whole -- the canvas cuts off what
// overhangs -- so a line over a tile edge goes on in the next tile at the same
// place and width.
//
// A circle is the ring the map SDKs draw (js-sdk-core circleToRing, copied
// below): its size in pixels doubles with each zoom, its outline is
// `strokeWidth` CSS pixels at every zoom, centred on the ring. Where the ring
// is round on screen to a quarter of a pixel (anything small, or not far from
// the equator) it is drawn as an arc; else as the ring's 128 points, simplified
// like a polygon's. Under a pixel across it is one pixel, under 4 px across it
// has no outline, as a polygon.
//
// Taps never see any of this -- they are resolved on the main thread against
// the original shapes.

const swShapeProviders = new Map();

/** Cells of the shape index, in Web Mercator units: one z12 tile. */
const SHAPE_CELL = 1 / 4096;
/** A shape covering more cells than this is kept in a list every query checks. */
const SHAPE_MAX_CELLS = 256;
/** Simplified copies kept per route, most recent zooms first. */
const SHAPE_ZOOMS_KEPT = 4;
const DP_TOLERANCE_PX = 0.5;
/**
 * Below this size on screen a polygon's outline is left out: a 1 px line round
 * a 3 px parcel is the whole parcel, and a city of them zoomed out turns into
 * the outline colour.
 */
const MIN_OUTLINED_PX = 4;

function decodePolyline6(encoded) {
    const out = [];
    let index = 0, lat = 0, lng = 0;
    const read = () => {
        let result = 0, shift = 0, byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result += (byte & 0x1f) * 2 ** shift;
            shift += 5;
        } while (byte >= 0x20);
        return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
    };
    while (index < encoded.length) {
        lat += read();
        lng += read();
        out.push(lat / 1e6, lng / 1e6);
    }
    return out;
}

function toMercatorRing(latLngs) {
    const n = latLngs.length / 2;
    const ring = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        const lat = Math.max(-85.05112878, Math.min(85.05112878, latLngs[i * 2]));
        const s = Math.sin((lat * Math.PI) / 180);
        ring[i * 2] = (latLngs[i * 2 + 1] + 180) / 360;
        ring[i * 2 + 1] = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }
    return ring;
}

function signedArea(ring) {
    let area = 0;
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        area += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
    }
    return area / 2;
}

function reversedRing(ring) {
    const n = ring.length / 2;
    const out = new Float64Array(ring.length);
    for (let i = 0; i < n; i++) {
        out[i * 2] = ring[(n - 1 - i) * 2];
        out[i * 2 + 1] = ring[(n - 1 - i) * 2 + 1];
    }
    return out;
}

function decodeSwPolygon(p) {
    // No rings: a polygon taken out of the tiles, its slot kept so the others keep their indices.
    if (p.rings.length === 0) return null;
    const rings = [];
    for (let r = 0; r < p.rings.length; r++) {
        let ring = toMercatorRing(decodePolyline6(p.rings[r]));
        if (ring.length < 6) {
            if (r === 0) return null;
            continue;
        }
        // Outline positive, holes negative: opposite windings under `nonzero`.
        const area = signedArea(ring);
        if ((r === 0 && area < 0) || (r > 0 && area > 0)) ring = reversedRing(ring);
        rings.push(ring);
    }
    const outer = rings[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
        if (outer[i] < minX) minX = outer[i];
        if (outer[i] > maxX) maxX = outer[i];
        if (outer[i + 1] < minY) minY = outer[i + 1];
        if (outer[i + 1] > maxY) maxY = outer[i + 1];
    }
    return {
        rings,
        bbox: [minX, minY, maxX, maxY],
        fill: p.fill,
        stroke: p.stroke,
        strokeWidth: p.strokeWidth,
    };
}

function decodeSwPolyline(p) {
    // An empty path: a polyline taken out of the tiles, its slot kept so the others keep their indices.
    if (!p.path) return null;
    const path = toMercatorRing(decodePolyline6(p.path));
    if (path.length < 4) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < path.length; i += 2) {
        if (path[i] < minX) minX = path[i];
        if (path[i] > maxX) maxX = path[i];
        if (path[i + 1] < minY) minY = path[i + 1];
        if (path[i + 1] > maxY) maxY = path[i + 1];
    }
    return {
        line: true,
        path,
        bbox: [minX, minY, maxX, maxY],
        fill: null,
        stroke: p.stroke,
        strokeWidth: p.strokeWidth,
    };
}

// js-sdk-core Earth.RADIUS_METERS / CIRCUMFERENCE_METERS and circleToRing's segments.
const EARTH_RADIUS_METERS = 6378137.0;
const EARTH_CIRCUMFERENCE_METERS = 2 * Math.PI * EARTH_RADIUS_METERS;
const CIRCLE_SEGMENTS = 128;
const MERCATOR_MAX_LAT = 85.05112878;
/** Past this difference (px) between the ring's radii on screen, a circle is drawn as its ring, not an arc. */
const CIRCLE_ARC_TOLERANCE_PX = 0.25;
const DEG = Math.PI / 180;

function mercatorY(lat) {
    const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
    const s = Math.sin(clamped * DEG);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** js-sdk-core Spherical.computeOffset: [lat, lng] `distance` metres from the origin towards `heading`. */
function computeOffset(lat, lng, distance, heading) {
    const d = distance / EARTH_RADIUS_METERS;
    const h = heading * DEG;
    const lat1 = lat * DEG, lng1 = lng * DEG;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h));
    const lng2 = lng1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 / DEG, lng2 / DEG];
}

function normalizeLng(lng) {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** js-sdk-core circleToRing: the open ring as flat [lat, lng, ...], longitudes round the centre's. */
function circleToRing(lat, lng, radius, geodesic, segments = CIRCLE_SEGMENTS) {
    if (!(radius > 0) || segments < 3) return [];
    const out = new Array(segments * 2);
    if (geodesic) {
        for (let i = 0; i < segments; i++) {
            const p = computeOffset(lat, lng, radius, (360.0 * i) / segments);
            out[i * 2] = p[0];
            out[i * 2 + 1] = lng + normalizeLng(p[1] - lng);
        }
        return out;
    }
    const metersPerDegree = EARTH_CIRCUMFERENCE_METERS / 360.0;
    const latCorrection = Math.max(Math.cos(lat * DEG), 1e-6);
    for (let i = 0; i < segments; i++) {
        const angle = (2.0 * Math.PI * i) / segments;
        out[i * 2] = Math.max(-90, Math.min(90, lat + (radius / metersPerDegree) * Math.cos(angle)));
        out[i * 2 + 1] = lng + (radius / (metersPerDegree * latCorrection)) * Math.sin(angle);
    }
    return out;
}

/**
 * A circle as the worker draws it: its centre and bounding box in Web Mercator,
 * from the same bounds as the ring (js-sdk-core circleTileExtent).
 */
function decodeSwCircle(c) {
    // No radius: a circle taken out of the tiles, its slot kept so the others keep their indices.
    if (!(c.radiusMeters > 0)) return null;
    const lat = c.latitude, lng = c.longitude, r = c.radiusMeters;
    let dLat, dLng;
    if (c.geodesic) {
        const delta = r / EARTH_RADIUS_METERS;
        const cosLat = Math.cos(lat * DEG);
        if (!(Math.sin(delta) < cosLat)) return null;
        dLat = delta / DEG;
        dLng = Math.asin(Math.min(1, Math.sin(delta) / cosLat)) / DEG;
    } else {
        const metersPerDegree = EARTH_CIRCUMFERENCE_METERS / 360;
        dLat = r / metersPerDegree;
        dLng = r / (metersPerDegree * Math.max(Math.cos(lat * DEG), 1e-6));
    }
    return {
        circle: true,
        latitude: lat,
        longitude: lng,
        radiusMeters: r,
        geodesic: !!c.geodesic,
        cx: (lng + 180) / 360,
        cy: mercatorY(lat),
        // [west, y(north), east, y(south)]
        bbox: [(lng - dLng + 180) / 360, mercatorY(lat + dLat), (lng + dLng + 180) / 360, mercatorY(lat - dLat)],
        fill: c.fill,
        stroke: c.stroke,
        strokeWidth: c.strokeWidth,
    };
}

/**
 * A circle at `scale` (world pixels): `{ dot }` under a pixel across, `{ arc: [cx, cy, r] }`
 * where the ring is round to CIRCLE_ARC_TOLERANCE_PX, else `{ rings: [ring] }`.
 */
function simplifyCircle(p, scale) {
    const cx = p.cx * scale, cy = p.cy * scale;
    const rx = (p.bbox[2] - p.cx) * scale;
    const ryN = cy - p.bbox[1] * scale;
    const ryS = p.bbox[3] * scale - cy;
    const radius = Math.max(rx, ryN, ryS);
    if (radius < 0.5) return { dot: [Math.floor(cx), Math.floor(cy)] };
    const outlined = 2 * radius >= MIN_OUTLINED_PX;
    if (Math.max(Math.abs(ryN - rx), Math.abs(ryS - rx)) <= CIRCLE_ARC_TOLERANCE_PX) {
        return { arc: [cx, cy, rx], outlined };
    }
    const ring = simplifyRing(toMercatorRing(circleToRing(p.latitude, p.longitude, p.radiusMeters, p.geodesic)), scale);
    if (!ring) return { dot: [Math.floor(cx), Math.floor(cy)] };
    return { rings: [ring], outlined };
}

// Classify without allocating a projected shape for every hidden circle.
function circleDotSlot(p, scale, originX, originY, tileSize) {
    const radius = Math.max(p.bbox[2] - p.cx, p.cy - p.bbox[1], p.bbox[3] - p.cy) * scale;
    if (radius >= 0.5) return -2;
    const x = Math.floor(p.cx * scale) - originX;
    const y = Math.floor(p.cy * scale) - originY;
    return x >= 0 && x < tileSize && y >= 0 && y < tileSize ? y * tileSize + x : -1;
}

/** False for a colour that draws nothing: none, `transparent`, or alpha 0 (rgba(), #rgba, #rrggbbaa). */
function isVisibleColor(color) {
    if (!color || color === 'transparent') return false;
    const m = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(color);
    if (m) return parseFloat(m[1]) > 0;
    if (/^#[0-9a-f]{4}$/i.test(color)) return color[4] !== '0';
    if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(7) !== '00';
    return true;
}

function buildShapeIndex(shapes, index = { cells: new Map(), groups: new Map(), large: [] }, start = 0) {
    const { cells, groups, large } = index;
    for (let i = 0; i < shapes.length; i++) {
        const p = shapes[i];
        if (!p) continue;
        const cx0 = Math.floor(p.bbox[0] / SHAPE_CELL), cx1 = Math.floor(p.bbox[2] / SHAPE_CELL);
        const cy0 = Math.floor(p.bbox[1] / SHAPE_CELL), cy1 = Math.floor(p.bbox[3] / SHAPE_CELL);
        if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > SHAPE_MAX_CELLS) {
            large.push(start + i);
            continue;
        }
        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
                const key = cx * 1048576 + cy;
                const bucket = cells.get(key);
                if (bucket) bucket.push(start + i);
                else {
                    const created = [start + i];
                    cells.set(key, created);
                    const groupKey = Math.floor(cx / 16) * 1048576 + Math.floor(cy / 16);
                    const group = groups.get(groupKey);
                    if (group) group.push(created);
                    else groups.set(groupKey, [created]);
                }
            }
        }
    }
    return index;
}

// Cache Storage is available from the service worker. Each staged generation
// gets its own cache so replacement never exposes a partially written model.
const circleCachePrefix = 'mc-circle-geometry:' + self.registration?.scope + ':';
const pendingCircleFiles = new Map();
const circleOperations = new Map();
const circleRenders = new Map();
const CIRCLE_RECORD_WIDTH = 13;

function enqueueCircleOperation(routeId, operation, queue = circleOperations) {
    const next = (queue.get(routeId) ?? Promise.resolve()).then(operation);
    const settled = next.catch(() => {});
    queue.set(routeId, settled);
    void settled.then(() => {
        if (queue.get(routeId) === settled) queue.delete(routeId);
    });
    return next;
}

function circleBlockKey(block) {
    return new URL('__mc_circle_geometry__/' + block, self.registration.scope).href;
}

async function writeCircleBlock(file, block, shapes) {
    // Fixed-width records preserve projected bounds and geographic geometry.
    // Keep color strings once per route to retain the original CSS semantics.
    const records = new Float64Array(shapes.length * CIRCLE_RECORD_WIDTH);
    for (let i = 0; i < shapes.length; i++) {
        const p = shapes[i];
        if (!p) continue;
        records.set([
            p.radiusMeters, p.latitude, p.longitude, Number(p.geodesic),
            p.cx, p.cy, ...p.bbox, p.strokeWidth, circleColorIndex(file, p.fill), circleColorIndex(file, p.stroke),
        ], i * CIRCLE_RECORD_WIDTH);
    }
    await file.cache.put(circleBlockKey(block), new Response(records));
    file.blocks.delete(block);
}

function circleColorIndex(file, color) {
    let index = file.colorIndices.get(color);
    if (index === undefined) {
        index = file.colors.length;
        file.colors.push(color);
        file.colorIndices.set(color, index);
    }
    return index;
}

function readCircleBlock(file, block) {
    let entry = file.blocks.get(block);
    if (!entry) {
        entry = file.cache.match(circleBlockKey(block)).then(async response => {
            if (!response) throw new Error('Circle geometry block unavailable');
            return new Float64Array(await response.arrayBuffer());
        });
        void entry.catch(() => {
            if (file.blocks.get(block) === entry) file.blocks.delete(block);
        });
    }
    file.blocks.delete(block);
    file.blocks.set(block, entry);
    if (file.blocks.size > 8) file.blocks.delete(file.blocks.keys().next().value);
    return entry;
}

function unpackCircle(file, records, index, bounds) {
    const i = index * CIRCLE_RECORD_WIDTH;
    if (!(records[i] > 0)) return null;
    if (bounds && (records[i + 6] > bounds[2] || records[i + 8] < bounds[0]
        || records[i + 7] > bounds[3] || records[i + 9] < bounds[1])) return null;
    return {
        circle: true, radiusMeters: records[i], latitude: records[i + 1], longitude: records[i + 2],
        geodesic: records[i + 3] !== 0, cx: records[i + 4], cy: records[i + 5],
        bbox: [records[i + 6], records[i + 7], records[i + 8], records[i + 9]],
        strokeWidth: records[i + 10], fill: file.colors[records[i + 11]], stroke: file.colors[records[i + 12]],
    };
}

async function readCircleShapes(file, block) {
    const records = await readCircleBlock(file, block);
    return Array.from({ length: records.length / CIRCLE_RECORD_WIDTH }, (_, i) => unpackCircle(file, records, i));
}

async function discardCircleFile(file) {
    if (file) await caches.delete(file.name);
}

async function handleCircleFileMessage(msg, clientId) {
    const { routeId, token } = msg;
    const pending = pendingCircleFiles.get(routeId);
    if (msg.type === 'sw-circle-file-activate') {
        const provider = swShapeProviders.get(routeId);
        if (!provider?.file || msg.mask.length !== provider.file.count) return false;
        provider.active = msg.mask;
        provider.generation++;
        dropAllShapeTiles(routeId);
        return true;
    }
    if (msg.type === 'sw-circle-file-begin') {
        await discardCircleFile(pending);
        const clients = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map(client => client.id));
        clients.add(clientId);
        for (const key of await caches.keys()) {
            if (key.startsWith(circleCachePrefix) && !clients.has(key.slice(circleCachePrefix.length).split(':')[0])) {
                await caches.delete(key);
            }
        }
        const name = circleCachePrefix + clientId + ':' + routeId + ':' + token;
        pendingCircleFiles.set(routeId, {
            token, name, cache: await caches.open(name), blockSize: msg.blockSize, count: msg.count,
            written: 0, blocks: new Map(), colors: [], colorIndices: new Map(),
            index: buildShapeIndex([]), maxStrokePx: 0,
        });
        return true;
    }
    if (!pending || pending.token !== token) return false;
    if (msg.type === 'sw-circle-file-abort') {
        pendingCircleFiles.delete(routeId);
        await discardCircleFile(pending);
        return true;
    }
    if (msg.type === 'sw-circle-file-block') {
        if (msg.start !== pending.written || msg.circles.length !== Math.min(pending.blockSize, pending.count - msg.start)) return false;
        const shapes = msg.circles.map(decodeSwCircle);
        await writeCircleBlock(pending, msg.start / pending.blockSize, shapes);
        buildShapeIndex(shapes, pending.index, msg.start);
        pending.maxStrokePx = maxShapeStroke(shapes, pending.maxStrokePx);
        pending.written += shapes.length;
        return true;
    }
    if (pending.written !== pending.count) return false;
    const previous = swShapeProviders.get(routeId);
    swShapeProviders.set(routeId, {
        file: pending, index: pending.index, maxStrokePx: pending.maxStrokePx,
        stamp: new Uint32Array(pending.count), stampValue: 0, generation: 0,
    });
    pendingCircleFiles.delete(routeId);
    dropAllShapeTiles(routeId);
    await discardCircleFile(previous?.file);
    return true;
}

function maxShapeStroke(shapes, initial = 0) {
    let maxStrokePx = initial;
    for (const p of shapes) if (p && isVisibleColor(p.stroke)) maxStrokePx = Math.max(maxStrokePx, p.strokeWidth);
    return maxStrokePx;
}

async function updateCircleFile(routeId, provider, updates) {
    const file = provider.file;
    const byBlock = new Map();
    for (const update of updates) {
        if (update.index < 0 || update.index >= file.count) continue;
        const block = Math.floor(update.index / file.blockSize);
        if (!byBlock.has(block)) byBlock.set(block, []);
        byBlock.get(block).push(update);
    }
    provider.generation++;
    let moved = false;
    const touched = [];
    for (const [block, changes] of byBlock) {
        const shapes = await readCircleShapes(file, block);
        for (const { index, shape } of changes) {
            const offset = index % file.blockSize;
            const before = shapes[offset];
            shapes[offset] = shape;
            if (before) touched.push(before.bbox);
            if (shape) {
                touched.push(shape.bbox);
                if (!before || before.bbox.some((v, k) => v !== shape.bbox[k])) moved = true;
            }
        }
        await writeCircleBlock(file, block, shapes);
        provider.maxStrokePx = maxShapeStroke(shapes, provider.maxStrokePx);
    }
    if (moved) {
        const index = buildShapeIndex([]);
        for (let start = 0; start < file.count; start += file.blockSize) {
            buildShapeIndex(await readCircleShapes(file, start / file.blockSize), index, start);
        }
        provider.index = index;
    }
    dropShapeTilesIn(routeId, touched, provider.maxStrokePx);
}

function registerSwShapes(routeId, shapes) {
    swShapeProviders.set(routeId, {
        shapes,
        index: buildShapeIndex(shapes),
        maxStrokePx: maxShapeStroke(shapes),
        simplified: new Map(),
        stamp: new Uint32Array(shapes.length),
        stampValue: 0,
        // Bumped by every update, so a tile drawn before it is not cached after it.
        generation: 0,
    });
    dropAllShapeTiles(routeId);
}

/** `updates`: [{ index, shape }], the shape decoded (null for an emptied slot). */
function updateSwShapes(routeId, updates) {
    const provider = swShapeProviders.get(routeId);
    if (!provider) return;
    provider.generation++;
    const touched = [];
    let moved = false;
    for (const u of updates) {
        const before = provider.shapes[u.index];
        const after = u.shape;
        provider.shapes[u.index] = after;
        for (const perZoom of provider.simplified.values()) perZoom[u.index] = undefined;
        if (before) touched.push(before.bbox);
        if (after) touched.push(after.bbox);
        if (after && isVisibleColor(after.stroke)) provider.maxStrokePx = Math.max(provider.maxStrokePx, after.strokeWidth);
        // A shape that moved needs the index rebuilt; a restyle does not.
        if (after && (!before || before.bbox.some((v, k) => v !== after.bbox[k]))) moved = true;
    }
    if (moved) provider.index = buildShapeIndex(provider.shapes);
    dropShapeTilesIn(routeId, touched, provider.maxStrokePx);
}

/**
 * Tiles of a shape route are cached without the version segment of their
 * URL, so a version bump (which the map needs to ask again at all) finds every
 * tile a change did not touch still cached. The tiles that do overlap a
 * changed shape, grown by the widest stroke, are dropped here.
 */
function shapeTileCacheKey(routeId, tileSize, z, x, y, pixelRatio) {
    return 'poly:' + routeId + '/' + tileSize + '/' + z + '/' + x + '/' + y + '@' + pixelRatio;
}

function dropShapeTilesIn(routeId, boxes, strokePx) {
    const prefix = 'poly:' + routeId + '/';
    for (const key of Array.from(tileCache.keys())) {
        if (!key.startsWith(prefix)) continue;
        const [tileSize, z, x, rest] = key.slice(prefix.length).split('/');
        const y = parseInt(rest, 10);
        const scale = +tileSize * 2 ** +z;
        const pad = (strokePx + 2) / scale;
        const tx0 = (+x * +tileSize) / scale - pad, tx1 = ((+x + 1) * +tileSize) / scale + pad;
        const ty0 = (y * +tileSize) / scale - pad, ty1 = ((y + 1) * +tileSize) / scale + pad;
        if (boxes.some((b) => b[0] <= tx1 && b[2] >= tx0 && b[1] <= ty1 && b[3] >= ty0)) {
            tileCacheBytes -= tileCache.get(key).byteLength;
            tileCache.delete(key);
        }
    }
}

function dropAllShapeTiles(routeId) {
    const prefix = 'poly:' + routeId + '/';
    for (const key of Array.from(tileCache.keys())) {
        if (key.startsWith(prefix)) {
            tileCacheBytes -= tileCache.get(key).byteLength;
            tileCache.delete(key);
        }
    }
}

function queryShapes(provider, minX, minY, maxX, maxY) {
    provider.stampValue = (provider.stampValue + 1) >>> 0;
    if (provider.stampValue === 0) {
        provider.stamp.fill(0);
        provider.stampValue = 1;
    }
    const stamp = provider.stamp, v = provider.stampValue;
    const out = [];
    const take = (i) => {
        if (provider.active && !provider.active[i]) return;
        if (stamp[i] === v) return;
        stamp[i] = v;
        if (provider.file || overlapsShapeBox(provider.shapes[i], minX, minY, maxX, maxY)) out.push(i);
    };
    for (const i of provider.index.large) take(i);
    const cx0 = Math.floor(minX / SHAPE_CELL), cx1 = Math.floor(maxX / SHAPE_CELL);
    const cy0 = Math.floor(minY / SHAPE_CELL), cy1 = Math.floor(maxY / SHAPE_CELL);
    const area = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    const groups = provider.index.groups;
    if (area > 16_384 && groups) {
        const gx0 = Math.floor(cx0 / 16), gx1 = Math.floor(cx1 / 16);
        const gy0 = Math.floor(cy0 / 16), gy1 = Math.floor(cy1 / 16);
        if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > groups.size) {
            for (const bucket of provider.index.cells.values()) for (const i of bucket) take(i);
        } else {
            for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
                const buckets = groups.get(gx * 1048576 + gy);
                if (buckets) for (const bucket of buckets) for (const i of bucket) take(i);
            }
        }
    } else for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
            const bucket = provider.index.cells.get(cx * 1048576 + cy);
            if (bucket) for (const i of bucket) take(i);
        }
    }
    // Draw order is registration order, which the main thread sorted by zIndex.
    return out.sort((a, b) => a - b);
}

function overlapsShapeBox(shape, minX, minY, maxX, maxY) {
    const b = shape?.bbox;
    return b && b[0] <= maxX && b[2] >= minX && b[1] <= maxY && b[3] >= minY;
}

// Yield only once per block. The inner drawing loop stays synchronous.
async function* shapeBlocks(provider, candidates, bounds, isStale) {
    if (!provider.file) {
        yield { start: 0, end: candidates.length, at: (index) => provider.shapes[index] };
        return;
    }
    const { blockSize } = provider.file;
    for (let start = 0; start < candidates.length;) {
        if (isStale()) return;
        const block = Math.floor(candidates[start] / blockSize);
        const offset = block * blockSize;
        let end = start + 1;
        while (end < candidates.length && candidates[end] < offset + blockSize) end++;
        const records = await readCircleBlock(provider.file, block);
        yield { start, end, at: (index) => unpackCircle(provider.file, records, index - offset, bounds) };
        start = end;
    }
}

/** Douglas-Peucker on snapped integer points [x0, y0, x1, y1, ...]; returns the kept points. */
function douglasPeucker(points, tolerance) {
    const n = points.length / 2;
    if (n < 3) return points;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [0, n - 1];
    while (stack.length) {
        const b = stack.pop(), a = stack.pop();
        const ax = points[a * 2], ay = points[a * 2 + 1], bx = points[b * 2], by = points[b * 2 + 1];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        let best = -1, bestIndex = -1;
        for (let i = a + 1; i < b; i++) {
            const px = points[i * 2], py = points[i * 2 + 1];
            const d = len ? Math.abs(dy * (px - ax) - dx * (py - ay)) / len : Math.hypot(px - ax, py - ay);
            if (d > best) { best = d; bestIndex = i; }
        }
        if (best > tolerance) {
            keep[bestIndex] = 1;
            stack.push(a, bestIndex, bestIndex, b);
        }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
    return out;
}

/** Points snapped to the pixel grid at `scale`, repeats dropped, then Douglas-Peucker (ends kept). */
function snapAndSimplify(points, scale) {
    const snapped = [];
    let px = NaN, py = NaN;
    for (let i = 0; i < points.length; i += 2) {
        const x = Math.round(points[i] * scale), y = Math.round(points[i + 1] * scale);
        if (x === px && y === py) continue;
        snapped.push(x, y);
        px = x; py = y;
    }
    return douglasPeucker(snapped, DP_TOLERANCE_PX);
}

function simplifyRing(ring, scale) {
    const simplified = snapAndSimplify(ring, scale);
    return simplified.length >= 6 ? simplified : null;
}

/** An open path at `scale`, or null when it comes down to one point. */
function simplifyPath(path, scale) {
    const simplified = snapAndSimplify(path, scale);
    return simplified.length >= 4 ? simplified : null;
}

/**
 * The shape as drawn at zoom `z`, in world pixels: a polygon's `{ rings }`, a
 * polyline's `{ path }`, a `{ dot }` for either under a pixel, or null when
 * nothing of it is visible.
 */
function simplifiedAt(provider, index, z, tileSize) {
    const circle = provider.shapes[index];
    if (circle?.circle) return simplifyCircle(circle, tileSize * 2 ** z);
    const key = z + '/' + tileSize;
    let perZoom = provider.simplified.get(key);
    if (!perZoom) {
        perZoom = new Array(provider.shapes.length);
        provider.simplified.set(key, perZoom);
        while (provider.simplified.size > SHAPE_ZOOMS_KEPT) {
            provider.simplified.delete(provider.simplified.keys().next().value);
        }
    } else {
        provider.simplified.delete(key);
        provider.simplified.set(key, perZoom);
    }
    const cached = perZoom[index];
    if (cached !== undefined) return cached;
    const p = provider.shapes[index];
    const scale = tileSize * 2 ** z;
    let result = null;
    if (p && p.circle) {
        result = simplifyCircle(p, scale);
    } else if (p && p.line) {
        const w = (p.bbox[2] - p.bbox[0]) * scale, h = (p.bbox[3] - p.bbox[1]) * scale;
        const path = w < 1 && h < 1 ? null : simplifyPath(p.path, scale);
        // Down to one point: a dot at the middle of the line.
        result = path ? { path } : { dot: [((p.bbox[0] + p.bbox[2]) / 2) * scale, ((p.bbox[1] + p.bbox[3]) / 2) * scale] };
    } else if (p) {
        const w = (p.bbox[2] - p.bbox[0]) * scale, h = (p.bbox[3] - p.bbox[1]) * scale;
        if (w < 1 && h < 1) {
            result = { dot: [Math.floor(((p.bbox[0] + p.bbox[2]) / 2) * scale), Math.floor(((p.bbox[1] + p.bbox[3]) / 2) * scale)] };
        } else {
            const outer = simplifyRing(p.rings[0], scale);
            if (outer) {
                const rings = [outer];
                for (let r = 1; r < p.rings.length; r++) {
                    const hole = simplifyRing(p.rings[r], scale);
                    if (hole) rings.push(hole);
                }
                result = { rings, outlined: Math.max(w, h) >= MIN_OUTLINED_PX };
            } else {
                result = { dot: [Math.round(((p.bbox[0] + p.bbox[2]) / 2) * scale), Math.round(((p.bbox[1] + p.bbox[3]) / 2) * scale)] };
            }
        }
    }
    perZoom[index] = result;
    return result;
}

/** A tile of a shape route: `{ kind: 'tile', blob }`, `{ kind: 'empty' }` or `{ kind: 'failed' }`. */
async function renderShapeTile(provider, x, y, z, tileSize, pixelRatio = 1, isStale = () => false) {
    const scale = tileSize * 2 ** z;
    const originX = x * tileSize, originY = y * tileSize;
    const pad = provider.maxStrokePx / 2 + 1;
    const bounds = [
        (originX - pad) / scale, (originY - pad) / scale,
        (originX + tileSize + pad) / scale, (originY + tileSize + pad) / scale,
    ];
    const candidates = queryShapes(provider, ...bounds);
    if (candidates.length === 0) return { kind: 'empty' };

    const r = pixelRatio;
    const canvas = new OffscreenCanvas(tileSize * r, tileSize * r);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { kind: 'failed' };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // One display representative per world pixel, only for subpixel circles.
    const lastCircleDot = provider.file || provider.shapes[candidates[0]]?.circle ? new Int32Array(tileSize * tileSize) : null;
    const worldScale = tileSize * 2 ** z;
    if (lastCircleDot) for await (const { start, end, at } of shapeBlocks(provider, candidates, bounds, isStale)) {
        for (let i = start; i < end; i++) {
            const index = candidates[i], p = at(index);
            if (!p?.circle) continue;
            if (!(isVisibleColor(p.fill) || (p.strokeWidth > 0 && isVisibleColor(p.stroke)))) continue;
            const slot = circleDotSlot(p, worldScale, originX, originY, tileSize);
            if (slot >= 0) lastCircleDot[slot] = index + 1;
        }
    }
    let drew = false;
    const drawCandidate = (p, index) => {
        if (p.circle && lastCircleDot) {
            const slot = circleDotSlot(p, worldScale, originX, originY, tileSize);
            if (slot === -1 || (slot >= 0 && lastCircleDot[slot] !== index + 1)) return;
        }
        const shape = p.circle ? simplifyCircle(p, worldScale) : simplifiedAt(provider, index, z, tileSize);
        if (!shape) return;
        if (p.line) {
            if (!(p.strokeWidth > 0) || !isVisibleColor(p.stroke)) return;
            const width = p.strokeWidth * r;
            if (shape.dot) {
                // A line shorter than a pixel: a round dot as wide as the line, at least a pixel.
                const dot = new Path2D();
                dot.arc((shape.dot[0] - originX) * r, (shape.dot[1] - originY) * r, Math.max(width, 1) / 2, 0, 2 * Math.PI);
                ctx.fillStyle = p.stroke;
                ctx.fill(dot);
            } else {
                // The whole path, overhang included: the canvas cuts it at the tile edge,
                // and the next tile draws the same path at the same place.
                const line = new Path2D();
                line.moveTo((shape.path[0] - originX) * r, (shape.path[1] - originY) * r);
                for (let i = 2; i < shape.path.length; i += 2) line.lineTo((shape.path[i] - originX) * r, (shape.path[i + 1] - originY) * r);
                ctx.strokeStyle = p.stroke;
                ctx.lineWidth = width;
                ctx.stroke(line);
            }
            drew = true;
            return;
        }
        const fillVisible = isVisibleColor(p.fill);
        const strokeVisible = p.strokeWidth > 0 && isVisibleColor(p.stroke) && (shape.dot != null || shape.outlined);
        if (shape.dot) {
            ctx.fillStyle = fillVisible ? p.fill : p.stroke;
            if (!fillVisible && !strokeVisible) return;
            ctx.fillRect((shape.dot[0] - originX) * r, (shape.dot[1] - originY) * r, r, r);
            drew = true;
            return;
        }
        const ringPath = (ring, path) => {
            path.moveTo((ring[0] - originX) * r, (ring[1] - originY) * r);
            for (let i = 2; i < ring.length; i += 2) path.lineTo((ring[i] - originX) * r, (ring[i + 1] - originY) * r);
            path.closePath();
        };
        // A circle round on screen: one arc, filled and stroked like a ring.
        const arcPath = (arc, path) => {
            path.arc((arc[0] - originX) * r, (arc[1] - originY) * r, arc[2] * r, 0, 2 * Math.PI);
        };
        if (fillVisible) {
            const path = new Path2D();
            if (shape.arc) arcPath(shape.arc, path);
            else for (const ring of shape.rings) ringPath(ring, path);
            ctx.fillStyle = p.fill;
            ctx.fill(path, 'nonzero');
            drew = true;
        }
        if (strokeVisible) {
            // Outline only, as the map SDKs draw it.
            const outline = new Path2D();
            if (shape.arc) arcPath(shape.arc, outline);
            else ringPath(shape.rings[0], outline);
            ctx.strokeStyle = p.stroke;
            ctx.lineWidth = p.strokeWidth * r;
            ctx.stroke(outline);
            drew = true;
        }
    };
    for await (const { start, end, at } of shapeBlocks(provider, candidates, bounds, isStale)) {
        for (let i = start; i < end; i++) {
            const index = candidates[i], p = at(index);
            if (p) drawCandidate(p, index);
        }
    }
    if (isStale()) return { kind: 'failed' };
    if (!drew) return { kind: 'empty' };
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (!blob || blob.size === 0) return { kind: 'failed' };
    return { kind: 'tile', blob };
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
    const runCircleOperation = (operation) => {
        event.waitUntil(enqueueCircleOperation(msg.routeId, operation).then(
            ok => event.ports?.[0]?.postMessage({ ok }),
            error => {
                console.warn('[tile-sw] circle geometry:', error);
                event.ports?.[0]?.postMessage({ ok: false });
            },
        ));
    };
    if (msg.type === 'sw-register') {
        swProviders.set(msg.routeId, {
            items: msg.items,
            icons: msg.icons,
            labels: msg.labels ?? [],
            zoomScales: msg.zoomScales,
            extraIconScale: msg.extraIconScale ?? 1.0,
            declutterPx: msg.declutterPx ?? 0,
            grid: buildGrid(msg.items),
            queryPaddingByZoom: new Map(),
        });
        // A re-registration means the markers changed, so anything already
        // drawn for this route is wrong.
        dropCachedTiles(msg.routeId);
        console.log('[tile-sw] sw-register:', msg.routeId, 'items:', msg.items.length, 'icons:', msg.icons.length);
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
        }
    } else if (msg.type === 'sw-register-polygons') {
        registerSwShapes(msg.routeId, msg.polygons.map(decodeSwPolygon));
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
        }
    } else if (msg.type === 'sw-update-polygons') {
        updateSwShapes(msg.routeId, msg.updates.map((u) => ({ index: u.index, shape: decodeSwPolygon(u.polygon) })));
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
        }
    } else if (msg.type === 'sw-register-polylines') {
        registerSwShapes(msg.routeId, msg.polylines.map(decodeSwPolyline));
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
        }
    } else if (msg.type === 'sw-update-polylines') {
        updateSwShapes(msg.routeId, msg.updates.map((u) => ({ index: u.index, shape: decodeSwPolyline(u.polyline) })));
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
        }
    } else if (msg.type.startsWith('sw-circle-file-')) {
        runCircleOperation(() => handleCircleFileMessage(msg, event.source?.id ?? ''));
    } else if (msg.type === 'sw-register-circles') {
        runCircleOperation(async () => {
            const previous = swShapeProviders.get(msg.routeId);
            registerSwShapes(msg.routeId, msg.circles.map(decodeSwCircle));
            await discardCircleFile(previous?.file);
            return true;
        });
    } else if (msg.type === 'sw-update-circles') {
        runCircleOperation(async () => {
            const provider = swShapeProviders.get(msg.routeId);
            const updates = msg.updates.map((u) => ({ index: u.index, shape: decodeSwCircle(u.circle) }));
            if (provider?.file) await updateCircleFile(msg.routeId, provider, updates);
            else updateSwShapes(msg.routeId, updates);
            return !!provider;
        });
    } else if (msg.type === 'sw-unregister') {
        swProviders.delete(msg.routeId);
        dropCachedTiles(msg.routeId);
        if (msg.routeId.startsWith('circles-')) {
            runCircleOperation(async () => {
                const provider = swShapeProviders.get(msg.routeId);
                const pending = pendingCircleFiles.get(msg.routeId);
                pendingCircleFiles.delete(msg.routeId);
                swShapeProviders.delete(msg.routeId);
                dropAllShapeTiles(msg.routeId);
                await discardCircleFile(provider?.file);
                await discardCircleFile(pending);
                return true;
            });
        } else if (swShapeProviders.delete(msg.routeId)) dropAllShapeTiles(msg.routeId);
        console.log('[tile-sw] sw-unregister:', msg.routeId);
    }
});

/**
 * The most device pixels per CSS pixel a tile is drawn at. Phones report 3,
 * but a 3x tile is nine times the pixels of a 1x one for a difference few can
 * see at icon size; LocalTileServer caps the request at 2 before it gets here.
 */
const MAX_PIXEL_RATIO = 3;

// pathname: /__tiles/{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}{@2x?}.png
//
// `@{n}x` asks for the tile at n device pixels per CSS pixel: the image is
// n times wider and taller, and the map still lays it out as `tileSize` CSS
// pixels, so it lands one image pixel per screen pixel on a high-density
// display instead of being stretched. Without it the tile is 1x, as before.
function parseTileUrl(pathname) {
    const m = pathname.match(/^\/__tiles\/([^/]+)\/(\d+)\/(?:[^/]+\/)?(\d+)\/(\d+)\/(\d+)(?:@(\d+)x)?\.png$/);
    if (!m) return null;
    const pixelRatio = m[6] ? Math.min(Math.max(+m[6], 1), MAX_PIXEL_RATIO) : 1;
    return { routeId: m[1], tileSize: +m[2], z: +m[3], x: +m[4], y: +m[5], pixelRatio };
}

function toWorldPixel(lat, lng, z) {
    const scale = 256 * Math.pow(2, z);
    const wx = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { wx, wy };
}

function tileToGeoBounds(x, y, z, tileSize, paddingPx = 0) {
    const n = Math.pow(2, z);
    const tilesPerWorld = (256 / tileSize) * n;
    const pad = paddingPx / tileSize;
    const west = ((x - pad) / tilesPerWorld) * 360 - 180;
    const east = ((x + 1 + pad) / tilesPerWorld) * 360 - 180;
    const latRad = (yy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / tilesPerWorld)));
    const north = (latRad(y - pad) * 180) / Math.PI;
    const south = (latRad(y + 1 + pad) * 180) / Math.PI;
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
    // 間引きのマス目 1 つ分も広げる。境界をまたぐマス目を両側のタイルが丸ごと見るので、
    // 同じ点を残す（MarkerTileRenderer.queryCandidates と同じ）。
    const { north, south, west, east } = tileToGeoBounds(x, y, z, tileSize, paddingPx + provider.declutterPx);
    return queryGrid(
        provider.grid,
        provider.items,
        south, north, west, east,
    );
}

function queryPaddingPx(provider, z) {
    const cached = provider.queryPaddingByZoom.get(z);
    if (cached !== undefined) return cached;
    const zoomScale = provider.zoomScales?.[Math.min(22, Math.floor(z))] ?? 1;
    const scale = Math.max(zoomScale * provider.extraIconScale, 0);
    let extent = 0;
    // Bounds must include icons whose anchors lie outside the first query.
    // Icons are deduplicated; cache the bound per zoom until re-registration.
    for (const icon of provider.icons) {
        if (!icon) continue;
        const width = Math.max(icon.size.width * scale, 1);
        const height = Math.max(icon.size.height * scale, 1);
        extent = Math.max(extent,
            width * Math.max(Math.abs(icon.anchor.x), Math.abs(1 - icon.anchor.x)),
            height * Math.max(Math.abs(icon.anchor.y), Math.abs(1 - icon.anchor.y)));
    }
    // ラベルも含める。隣のタイルの点のラベルがはみ出してくる分。
    for (const label of provider.labels) {
        if (!label) continue;
        extent = Math.max(extent,
            (Math.abs(label.centerOffset.x) + label.size.width / 2) * scale,
            (Math.abs(label.centerOffset.y) + label.size.height / 2) * scale);
    }
    const padding = Math.ceil(extent) + 2;
    provider.queryPaddingByZoom.set(z, padding);
    return padding;
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

        const drawW = Math.max(icon.size.width * scale, 1);
        const drawH = Math.max(icon.size.height * scale, 1);
        const anchorX = icon.anchor.x;
        const anchorY = icon.anchor.y;
        // 本体とラベルを合わせた範囲で、タイルにかかるかを見る。
        let left = drawW * anchorX;
        let right = drawW * (1 - anchorX);
        let top = drawH * anchorY;
        let bottom = drawH * (1 - anchorY);
        const labelData = item.labelIndex >= 0 ? provider.labels[item.labelIndex] : null;
        let label = null;
        if (labelData) {
            label = {
                bitmap: labelData.bitmap,
                centerOffsetX: labelData.centerOffset.x * scale,
                centerOffsetY: labelData.centerOffset.y * scale,
                drawW: Math.max(labelData.size.width * scale, 1),
                drawH: Math.max(labelData.size.height * scale, 1),
            };
            left = Math.max(left, label.drawW / 2 - label.centerOffsetX);
            right = Math.max(right, label.centerOffsetX + label.drawW / 2);
            top = Math.max(top, label.drawH / 2 - label.centerOffsetY);
            bottom = Math.max(bottom, label.centerOffsetY + label.drawH / 2);
        }
        if (centerX - left > tilePx || centerX + right < 0 ||
            centerY - top > tilePx || centerY + bottom < 0) continue;
        maxHalfExtentPx = Math.max(maxHalfExtentPx, left, right, top, bottom);

        markers.push({ bitmap: icon.bitmap, centerX, centerY, drawW, drawH, anchorX, anchorY, label });
    }

    return { markers, maxHalfExtentPx };
}

/**
 * Everything is worked out in CSS pixels, as at 1x, and only the canvas and
 * the final placement are multiplied by `pixelRatio`. Rounding happens after
 * that multiplication, so a marker lands on a whole device pixel.
 */
async function renderOffscreen(provider, x, y, z, tileSize, pixelRatio = 1) {
    const tileOriginX = x * tileSize;
    const tileOriginY = y * tileSize;
    const candidates = queryCandidates(provider, x, y, z, tileSize, queryPaddingPx(provider, z));
    if (candidates.length === 0) {
        if (provider.items.length > 0) {
            console.debug('[tile-sw] no candidates in bounds for z=' + z + ' x=' + x + ' y=' + y, 'totalItems:', provider.items.length);
        }
        return { kind: 'empty' };
    }

    const { markers, maxHalfExtentPx } = prepareMarkers(provider, candidates, tileOriginX, tileOriginY, z, tileSize);
    if (markers.length === 0) {
        console.debug('[tile-sw] candidates found but 0 markers prepared for z=' + z + ' x=' + x + ' y=' + y, 'candidates:', candidates.length, 'icons registered:', provider.icons.length);
        return { kind: 'empty' };
    }

    const paddingPx = Math.max(Math.ceil(maxHalfExtentPx + 2), 2);
    const r = pixelRatio;
    const offscreenSize = (tileSize + paddingPx * 2) * r;
    const canvas = new OffscreenCanvas(offscreenSize, offscreenSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { kind: 'failed' };

    // Whole pixels, and markers exactly on top of one another drawn once —
    // see the same loop in MarkerTileRenderer.draw() for why both matter.
    const placed = markers.map((m) => {
        const cx = m.centerX + paddingPx;
        const cy = m.centerY + paddingPx;
        return {
            bitmap: m.bitmap,
            dx: Math.round((cx - m.drawW * m.anchorX) * r),
            dy: Math.round((cy - m.drawH * m.anchorY) * r),
            w: Math.max(1, Math.round(m.drawW * r)),
            h: Math.max(1, Math.round(m.drawH * r)),
            worldX: m.centerX + tileOriginX,
            worldY: m.centerY + tileOriginY,
            label: m.label
                ? {
                    bitmap: m.label.bitmap,
                    dx: Math.round((cx + m.label.centerOffsetX - m.label.drawW / 2) * r),
                    dy: Math.round((cy + m.label.centerOffsetY - m.label.drawH / 2) * r),
                    w: Math.max(1, Math.round(m.label.drawW * r)),
                    h: Math.max(1, Math.round(m.label.drawH * r)),
                }
                : null,
        };
    });
    // 間引き（declutterPx）とラベル付きの優先は MarkerTileRenderer.draw() と同じ規則。
    // マス目は世界座標に固定し、ラベル付きを先に、ラベル付きどうしは世界座標で決める。
    const declutter = provider.declutterPx > 0;
    const cell = Math.max(provider.declutterPx, 1);
    const baseCellX = Math.floor(tileOriginX / cell);
    const baseCellY = Math.floor(tileOriginY / cell);
    const groupKey = (p) => declutter
        ? (Math.floor(p.worldX / cell) - baseCellX) + ',' + (Math.floor(p.worldY / cell) - baseCellY)
        : p.dx + ',' + p.dy + ',' + p.w + ',' + p.h;
    const worldKey = (p) => p.worldY * 1048576 + p.worldX;
    const lastAt = new Map();
    const seenIcon = new Map();
    const mixedIcons = new Set();
    const labelledWinner = new Map();
    for (let index = 0; index < placed.length; index++) {
        const p = placed[index];
        const key = groupKey(p);
        if (!declutter) {
            const previous = seenIcon.get(key);
            if (previous !== undefined && (previous !== p.bitmap || p.label || placed[lastAt.get(key) ?? index].label)) {
                mixedIcons.add(key);
            }
            seenIcon.set(key, p.bitmap);
        }
        lastAt.set(key, index);
        if (p.label) {
            const winner = labelledWinner.get(key);
            if (winner === undefined || worldKey(p) > worldKey(placed[winner])) labelledWinner.set(key, index);
        }
    }
    const drawn = placed.map((p, index) => {
        const key = groupKey(p);
        const winner = labelledWinner.get(key);
        if (declutter && winner !== undefined) return winner === index;
        return mixedIcons.has(key) || lastAt.get(key) === index;
    });
    for (let index = 0; index < placed.length; index++) {
        if (!drawn[index]) continue;
        const p = placed[index];
        ctx.drawImage(p.bitmap, p.dx, p.dy, p.w, p.h);
    }
    // 文字は本体をすべて描いたあと。ほかの点の下に字が隠れない。
    for (let index = 0; index < placed.length; index++) {
        const label = drawn[index] ? placed[index].label : null;
        if (label) ctx.drawImage(label.bitmap, label.dx, label.dy, label.w, label.h);
    }

    const finalCanvas = new OffscreenCanvas(tileSize * r, tileSize * r);
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) return { kind: 'failed' };
    finalCtx.drawImage(canvas, -paddingPx * r, -paddingPx * r);

    const blob = await finalCanvas.convertToBlob({ type: 'image/png' });
    if (!blob || blob.size === 0) {
        console.warn('[tile-sw] convertToBlob returned empty blob for tile', x, y, z);
        return { kind: 'failed' };
    }
    return { kind: 'tile', blob };
}

async function findWindowClient(clientId) {
    if (clientId) {
        const client = await self.clients.get(clientId);
        if (client && client.type === 'window') return client;
    }
    const windows = await self.clients.matchAll({ type: 'window' });
    return windows.find((c) => c.focused) ?? windows[0] ?? null;
}

/**
 * Nothing to draw here — a real answer, and a cacheable one.
 *
 * What this must never be used for is a tile that could not be drawn right
 * now. A map library keeps what it is given: a transparent picture handed out
 * for a failure becomes a hole that is never asked about again, and the
 * neighbouring tiles' overhang is cut off at its edge. ios-sdk and android-sdk
 * answer the same three ways -- empty with pixels, failure with 503, and 404
 * only for a path that names nothing.
 */
function emptyTileResponse() {
    return pngResponse(EMPTY_TILE);
}

/** Could not draw it now. The library will ask again; nothing is cached. */
function failedTileResponse() {
    return new Response('tile render failed', {
        status: 503,
        headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            'Retry-After': '1',
        },
    });
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

/**
 * The page's own read of a tile it handed here (`ShapeTileSet.fetchTile`) for
 * a route this worker no longer has: a restarted worker forgets the shapes it
 * was given. Sending it back to the page would have the page fetch it again,
 * and the two would pass the tile back and forth without end (tens of
 * thousands of requests a minute, until the browser runs out of memory).
 * Answer it as missing instead, so the page registers the shapes again.
 */
function routeMissingResponse() {
    return new Response('tile route missing', {
        status: 503,
        headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            'X-MC-Tile-Route': 'missing',
        },
    });
}

function postMessageRender(client, pathname) {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        // A page that never answered has not told us the tile is empty.
        const timeout = setTimeout(() => {
            console.warn('[tile-sw] main thread did not answer in 5s for', pathname);
            resolve(failedTileResponse());
        }, 5000);

        channel.port1.onmessage = (e) => {
            clearTimeout(timeout);
            const { result, outcome } = e.data;
            if (result) {
                resolve(pngResponse(result));
            } else if (outcome === 'failed') {
                resolve(failedTileResponse());
            } else {
                // 'empty', 'notFound', and pages older than this protocol,
                // where no bytes only ever meant nothing to draw.
                resolve(emptyTileResponse());
            }
        };

        client.postMessage({ type: 'tile-request', pathname }, [channel.port2]);
    });
}

async function mainThreadRender(pathname, clientId) {
    const client = await findWindowClient(clientId);
    // No page to draw it: nobody has said this tile is empty, so do not claim
    // it is. The next request will find a client.
    if (!client) return failedTileResponse();
    return postMessageRender(client, pathname);
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith('/__tiles/')) return;

    const parsed = parseTileUrl(url.pathname);
    if (!parsed) return;

    const { routeId, tileSize, x, y, z, pixelRatio } = parsed;
    const shapeProvider = swShapeProviders.get(routeId);
    if (shapeProvider && canRenderOffscreen()) {
        const key = shapeTileCacheKey(routeId, tileSize, z, x, y, pixelRatio);
        const cached = cachedTile(key);
        if (cached) {
            event.respondWith(pngResponse(cached));
            return;
        }
        const generation = shapeProvider.generation;
        const isStale = () => event.request.signal?.aborted
            || swShapeProviders.get(routeId) !== shapeProvider || shapeProvider.generation !== generation;
        event.respondWith(
            (shapeProvider.file
                ? enqueueCircleOperation(routeId, async () => {
                    await circleOperations.get(routeId);
                    if (isStale()) return { kind: 'failed' };
                    return renderShapeTile(shapeProvider, x, y, z, tileSize, pixelRatio, isStale);
                }, circleRenders)
                : renderShapeTile(shapeProvider, x, y, z, tileSize, pixelRatio))
                .then(async (outcome) => {
                    if (outcome.kind === 'empty') return emptyTileResponse();
                    if (outcome.kind === 'failed') return failedTileResponse();
                    const bytes = await outcome.blob.arrayBuffer();
                    // The route may have been replaced or changed while this tile was drawn.
                    if (swShapeProviders.get(routeId) === shapeProvider && shapeProvider.generation === generation) {
                        cacheTile(key, bytes);
                    }
                    return pngResponse(bytes);
                })
                .catch((err) => {
                    console.warn('[tile-sw] shape tile failed:', err);
                    return failedTileResponse();
                }),
        );
        return;
    }
    const swProvider = swProviders.get(routeId);
    if (!swProvider && event.request.headers?.get('X-MC-Tile-Relay')) {
        event.respondWith(routeMissingResponse());
        return;
    }
    const offscreenOk = canRenderOffscreen();
    console.log('[tile-sw] fetch z=' + z + ' x=' + x + ' y=' + y, 'swProvider:', !!swProvider, 'offscreen:', offscreenOk, 'clientId:', event.clientId);

    if (swProvider && offscreenOk) {
        const cached = cachedTile(url.pathname);
        if (cached) {
            // A fresh Response each time: a body can only be read once, so the
            // cache holds the bytes rather than the Response.
            event.respondWith(pngResponse(cached));
            return;
        }
        event.respondWith(
            renderOffscreen(swProvider, x, y, z, tileSize, pixelRatio)
                .then(async (outcome) => {
                    if (outcome.kind === 'empty') return emptyTileResponse();
                    if (outcome.kind === 'failed') return failedTileResponse();
                    const bytes = await outcome.blob.arrayBuffer();
                    cacheTile(url.pathname, bytes);
                    return pngResponse(bytes);
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
