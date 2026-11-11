import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

/**
 * 円のタイル化（CircleTiler / CircleTileSet / tile-sw.js の Shape tiles の円）。
 *
 * android-sdk の `CircleTilingTest`、ios-sdk の `CircleTilingTests` と 1 対 1 で対応する。
 *
 * ## なぜここを固定するか
 *
 * タイルで描いた円は、地図 SDK が描く円（core の circleToRing の 128 角形）と「同じ所に同じ大きさで」
 * 出なければならない。崩れ方はどれも画面で見てやっと分かる種類のもの:
 * - 半径を画面の単位で持つと、ズームしても円が大きくならない（半径は地上のメートル）。
 * - 縁幅をズームの単位で持つと、ズームのたびに縁が太る（縁幅は画面上の CSS px）。
 * - 候補を引く範囲・外接範囲に半径を入れないと、タイルの端にかかる円が隣のタイルで欠ける。
 * - 高緯度の大きな円はメルカトルで北に伸びる。真円で描くとネイティブとずれる（Ring で描く）。
 * - 1 px 未満の円を捨てると、引いた地図で木が消える（1 px の点で残す）。
 * - null の zIndex を 0 として並べると、ネイティブ（自動 zIndex）と重なりが逆になる。
 *
 * 経路は本物を通す: CircleController → CircleTiler → CircleTileSet → LocalTileServer →
 * tile-sw.js（vm で動かす）。タイルの中身は、偽の OffscreenCanvas が記録した塗り・線（moveTo/lineTo/arc・
 * 線幅）を、ここで画素に塗って見る（アンチエイリアスは見ない）。
 */

// ── tile-sw.js を vm で動かす。描いたものを記録する ─────────────────────────────
const renders = { count: 0 };
class Path2D {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(['M', x, y]); }
  lineTo(x, y) { this.ops.push(['L', x, y]); }
  closePath() { this.ops.push(['Z']); }
  arc(x, y, radius) { this.ops.push(['A', x, y, radius]); }
}
class Canvas {
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
    this.draws = [];
    if (width > 1) renders.count++; // the worker's 1x1 probe is not a tile
  }
  getContext() {
    const canvas = this;
    return {
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
      stroke(path) { canvas.draws.push({ kind: 'stroke', color: this.strokeStyle, width: this.lineWidth, ops: path.ops }); },
      fill(path) { canvas.draws.push({ kind: 'fill', color: this.fillStyle, ops: path.ops }); },
      fillRect(x, y, w, h) { canvas.draws.push({ kind: 'rect', color: this.fillStyle, rect: [x, y, w, h] }); },
    };
  }
  async convertToBlob() {
    return new Blob([JSON.stringify({ width: this.width, height: this.height, draws: this.draws })]);
  }
}

const worker = readFileSync(new URL('../dist/tile-sw.js', import.meta.url), 'utf8');
const handlers = {};
const geometryCaches = new Map();
const caches = {
  async keys() { return [...geometryCaches.keys()]; },
  async delete(name) { return geometryCaches.delete(name); },
  async open(name) {
    const blocks = new Map();
    geometryCaches.set(name, blocks);
    return {
      async put(key, response) { blocks.set(key, await response.arrayBuffer()); },
      async match(key) { return blocks.has(key) ? new Response(blocks.get(key)) : undefined; },
    };
  },
};
const swContext = vm.createContext({
  self: {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    clients: { matchAll: async () => [{ id: 'page' }] },
    registration: { scope: 'https://example.test/' },
  },
  caches,
  console: { log() {}, debug() {}, warn() {}, error() {} },
  OffscreenCanvas: Canvas, Path2D, Blob, Response, URL, setTimeout, clearTimeout,
});
vm.runInContext(worker, swContext);

const PNG_SIGNATURE = [137, 80, 78, 71];

async function fetchTile(template, z, x, y, ratio = 1) {
  let path = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  if (ratio > 1) path = path.replace(/\.png$/, `@${ratio}x.png`);
  let response = null;
  handlers.fetch({ request: { url: 'https://example.test' + path }, respondWith: (r) => { response = r; }, clientId: 'page' });
  assert.ok(response, `no answer for ${path}`);
  const res = await response;
  assert.equal(res.status, 200);
  const body = new Uint8Array(await res.arrayBuffer());
  if (PNG_SIGNATURE.every((b, i) => body[i] === b)) return { empty: true };
  return JSON.parse(new TextDecoder().decode(body));
}

/** The closed outlines of a recorded path: rings of [x, y], or arcs [cx, cy, r]. */
function outlines(ops) {
  const rings = [], arcs = [];
  let ring = null;
  for (const op of ops) {
    if (op[0] === 'M') { ring = [[op[1], op[2]]]; rings.push(ring); }
    else if (op[0] === 'L') ring.push([op[1], op[2]]);
    else if (op[0] === 'A') arcs.push([op[1], op[2], op[3]]);
  }
  return { rings, arcs };
}

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The pixels a recorded tile paints: Map "x,y" -> colour of the last thing drawn there. */
function rasterize(tile) {
  const pixels = new Map();
  const paint = (covers, color) => {
    for (let py = 0; py < tile.height; py++) {
      for (let px = 0; px < tile.width; px++) {
        if (covers(px + 0.5, py + 0.5)) pixels.set(px + ',' + py, color);
      }
    }
  };
  for (const d of tile.draws) {
    if (d.kind === 'rect') {
      const [x0, y0, w, h] = d.rect;
      paint((x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h, d.color);
      continue;
    }
    const { rings, arcs } = outlines(d.ops);
    if (d.kind === 'fill') {
      paint((x, y) => arcs.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r) || rings.some((ring) => insideRing(x, y, ring)), d.color);
    } else {
      const half = d.width / 2;
      paint((x, y) =>
        arcs.some(([cx, cy, r]) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= half) ||
        rings.some((ring) => ring.some((a, i) => distanceToSegment(x, y, a, ring[(i + 1) % ring.length]) <= half)), d.color);
    }
  }
  return pixels;
}

/** The columns painted in row `y` (any colour), as [first, last], or null. */
function colsAt(pixels, y) {
  const cols = [];
  for (const key of pixels.keys()) {
    const [px, py] = key.split(',').map(Number);
    if (py === y) cols.push(px);
  }
  if (cols.length === 0) return null;
  cols.sort((a, b) => a - b);
  return [cols[0], cols.at(-1)];
}

/** How many pixels of `color` row `y` holds. */
function countIn(pixels, y, color) {
  let n = 0;
  for (const [key, c] of pixels) if (c === color && Number(key.split(',')[1]) === y) n++;
  return n;
}

// ── ページ側: service worker の代わりに上の vm へ渡す ─────────────────────────
const messages = [];
let workerIdle = Promise.resolve();
globalThis.location = { protocol: 'https:', hostname: 'example.test' };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    serviceWorker: {
      register: async () => ({}),
      addEventListener() {},
      removeEventListener() {},
      controller: {
        postMessage(data, ports = []) {
          messages.push(data.type);
          handlers.message({
            data, ports, source: { id: 'page' },
            waitUntil: (operation) => { workerIdle = operation; },
          });
        },
      },
    },
  },
});
globalThis.MessageChannel = class {
  constructor() {
    const port1 = { onmessage: null };
    this.port1 = port1;
    this.port2 = { postMessage: (data) => queueMicrotask(() => port1.onmessage?.({ data })) };
  }
};

const {
  createGeoPoint,
  createCircleState,
  circleToRing,
  CircleController,
  CircleManager,
  CircleTiler,
  CircleTileSet,
  CircleTilingOptions,
  circleMutations,
  OverlayCollector,
  CIRCLE_TILE_LAYER_ID,
  circleTileRasterLayerState,
  Earth,
  calculateMetersPerPixel,
  computeOffset,
} = await import('../dist/index.mjs');

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const settle = () => new Promise((r) => setTimeout(r, 40)); // tile updates coalesce for 16 ms

test('circle state keeps enumerable fields, bound methods and lazy subscriptions', () => {
  const state = createCircleState({ id: 'lazy', center: p(42, -71), radiusMeters: 500 });
  const { fingerPrint, asObservable, copy } = { ...state };
  state.radiusMeters = 600;
  const received = [];
  const unsubscribe = asObservable().subscribe(fp => received.push(fp));
  assert.deepEqual(received, [fingerPrint()]);
  state.onClick = () => {};
  assert.equal(received.length, 1);
  state.radiusMeters = 700;
  assert.equal(received.length, 2);
  unsubscribe();
  state.radiusMeters = 800;
  assert.equal(received.length, 2);
  assert.equal(copy().radiusMeters, 800);
});

test('the shared circle channel tracks updates without per-state subscriptions', async () => {
  const state = createCircleState({ id: 'shared', center: p(42, -71), radiusMeters: 500 });
  state.asObservable = () => { throw new Error('collector subscribed to a circle'); };
  const collector = new OverlayCollector(circleMutations);
  const updates = [];
  collector.setUpdateHandler(circle => updates.push(circle.radiusMeters));
  try {
    collector.add(state);
    state.radiusMeters = 600;
    await settle();
    assert.deepEqual(updates, [600]);
    collector.remove(state.id);
    state.radiusMeters = 700;
    await settle();
    assert.deepEqual(updates, [600]);
  } finally {
    collector.setUpdateHandler(null);
  }
});

/** The point at world pixel (wx, wy) of zoom z (256-px tiles). */
function atPixel(wx, wy, z) {
  const scale = 256 * 2 ** z;
  const longitude = (wx / scale) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / scale))) * 180) / Math.PI;
  return p(latitude, longitude);
}

/** World pixel of a point at zoom z. */
function toPixel(point, z) {
  const scale = 256 * 2 ** z;
  const s = Math.sin((point.latitude * Math.PI) / 180);
  return [((point.longitude + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

/** The geodesic radius (m) whose circle at `center` is `px` pixels across east-west at zoom z (rx of DESIGN 2.4). */
function radiusForPx(center, px, z) {
  const scale = 256 * 2 ** z;
  const dLng = (px / scale) * 2 * Math.PI; // radians
  const delta = Math.asin(Math.sin(dLng) * Math.cos((center.latitude * Math.PI) / 180));
  return delta * Earth.RADIUS_METERS;
}

// A tile in Boston at z16; circles are placed in its world pixels.
const Z = 16, TX = 19824, TY = 24247;
const OX = TX * 256, OY = TY * 256;
const FILL = 'rgba(0,128,0,1)';
const STROKE = 'rgba(255,0,0,1)';
const circleAt = (id, wx, wy, radiusPx, extra = {}) => {
  const center = atPixel(wx, wy, Z);
  return createCircleState({ id, center, radiusMeters: radiusForPx(center, radiusPx, Z), fillColor: FILL, strokeColor: STROKE, strokeWidth: 4, zIndex: 0, ...extra });
};

async function tiled(states) {
  const tiler = new CircleTiler({ enabled: true, minCircleCount: 1 });
  let template = null;
  tiler.onTemplate = (t) => { template = t; };
  const ids = await tiler.route(states);
  assert.equal(ids.size, states.filter((s) => CircleTileSet.canTile(s)).length);
  return { tiler, template: () => template };
}

test('しきい値: 個数が届けばタイル。判定はここ 1 か所', () => {
  const o = CircleTilingOptions.Default;
  assert.equal(o.enabled, true);
  assert.equal(o.minCircleCount, 2001);
  assert.equal(CircleTilingOptions.shouldUseTiles(o, 1999), false);
  assert.equal(CircleTilingOptions.shouldUseTiles(o, 2000), false);
  assert.equal(CircleTilingOptions.shouldUseTiles(o, 2001), true);
  assert.equal(CircleTilingOptions.shouldUseTiles(CircleTilingOptions.Disabled, 100_000), false);
});

test('subpixel circles share one pixel, but all return when zoomed in', async () => {
  const states = [
    circleAt('lower', OX + 100.25, OY + 100.25, 0.2),
    circleAt('upper', OX + 100.25, OY + 100.25, 0.2, { fillColor: 'rgba(255,0,0,0.65)' }),
  ];
  const { tiler, template } = await tiled(states);
  try {
    const small = await fetchTile(template(), Z, TX, TY);
    assert.equal(small.draws.length, 1);
    assert.equal(small.draws[0].color, 'rgba(255,0,0,0.65)');
    assert.equal(tiler.tiledStates().length, 2, 'source states are never discarded');
    const large = await fetchTile(template(), Z + 4, TX * 16 + 6, TY * 16 + 6);
    assert.equal(large.draws.filter(d => d.kind === 'fill').length, 2);
  } finally { await tiler.clear(); }
});

test('subpixel circles in different pixels and invisible winners do not hide each other', async () => {
  const { tiler, template } = await tiled([
    circleAt('a', OX + 100.25, OY + 100.25, 0.2),
    circleAt('b', OX + 101.25, OY + 100.25, 0.2),
    circleAt('hidden', OX + 100.25, OY + 100.25, 0.2, { fillColor: 'transparent', strokeColor: 'transparent' }),
  ]);
  try { assert.equal((await fetchTile(template(), Z, TX, TY)).draws.length, 2); }
  finally { await tiler.clear(); }
});

test('large circle registration streams blocks and preserves drawing, updates and cleanup', async () => {
  const colors = ['#0000ff', '#ff0000'];
  const states = Array.from({ length: 4097 }, (_, i) => circleAt(
    String(i), OX + 100.25, OY + 100.25, 0.2, { fillColor: colors[i % 2] },
  ));
  const start = messages.length;
  const { tiler, template } = await tiled(states);
  try {
    assert.deepEqual(messages.slice(start), [
      'sw-circle-file-begin', 'sw-circle-file-block', 'sw-circle-file-block', 'sw-circle-file-commit',
    ]);
    assert.equal(geometryCaches.size, 1);
    assert.equal((await fetchTile(template(), Z, TX, TY)).draws[0].color, colors[0]);
    const activation = messages.length;
    await tiler.route(states.slice(0, -1));
    assert.deepEqual(messages.slice(activation), ['sw-circle-file-activate']);
    assert.equal((await fetchTile(template(), Z, TX, TY)).draws[0].color, colors[1]);
    await tiler.route(states);
    assert.equal((await fetchTile(template(), Z, TX, TY)).draws[0].color, colors[0]);
    tiler.remove('4096');
    await settle();
    await workerIdle;
    assert.equal((await fetchTile(template(), Z, TX, TY)).draws[0].color, colors[1]);
  } finally {
    await tiler.clear();
    await workerIdle;
  }
  assert.equal(geometryCaches.size, 0);
});

test('canTile: 半径 0・非有限、極にかかる、日付変更線をまたぐ円はタイルにしない', () => {
  const c = (lat, lng, r, extra = {}) => createCircleState({ center: p(lat, lng), radiusMeters: r, ...extra });
  assert.equal(CircleTileSet.canTile(c(42, -71, 10)), true);
  assert.equal(CircleTileSet.canTile(c(42, -71, 0)), false);
  assert.equal(CircleTileSet.canTile(c(42, -71, -5)), false);
  assert.equal(CircleTileSet.canTile(c(42, -71, NaN)), false);
  assert.equal(CircleTileSet.canTile(c(42, -71, Infinity)), false);
  // Past Web Mercator's latitudes, or over a pole.
  assert.equal(CircleTileSet.canTile(c(85, 0, 10_000)), false);
  assert.equal(CircleTileSet.canTile(c(84.9, 0, 100)), true);
  assert.equal(CircleTileSet.canTile(c(-85, 0, 10_000)), false);
  assert.equal(CircleTileSet.canTile(c(80, 0, 2_000_000)), false);
  assert.equal(CircleTileSet.canTile(c(80, 0, 2_000_000, { geodesic: false })), false);
  // Across the antimeridian (both ways), or not.
  assert.equal(CircleTileSet.canTile(c(0, 179.99, 5_000)), false);
  assert.equal(CircleTileSet.canTile(c(0, -179.99, 5_000)), false);
  assert.equal(CircleTileSet.canTile(c(0, 179.9, 5_000)), true);
  // A centre given past 180 is the same place.
  assert.equal(CircleTileSet.canTile(c(42, 289, 10)), true);
});

test('route はタイルにした id を返し、レイヤーは CIRCLE_TILE_LAYER_ID で版つきの URL', async () => {
  const states = [circleAt('a', OX + 128, OY + 128, 20), createCircleState({ id: 'pole', center: p(89, 0), radiusMeters: 1000 })];
  const { tiler, template } = await tiled(states);
  assert.equal(tiler.isTiled('a'), true);
  assert.equal(tiler.isTiled('pole'), false);
  assert.deepEqual(tiler.tiledStates().map((s) => s.id), ['a']);
  assert.match(template(), /^\/__tiles\/circles-[a-z0-9]+\/256\/1\/\{z\}\/\{x\}\/\{y\}\.png$/);
  const layer = circleTileRasterLayerState(template());
  assert.equal(layer.id, CIRCLE_TILE_LAYER_ID);
  assert.equal(CIRCLE_TILE_LAYER_ID, 'mc-circle-tiles');
  await tiler.clear();
  assert.equal(template(), null);
});

test('中心の画素は塗り色、半径の位置に縁の色（縁は輪郭の上に中心を合わせる）', async () => {
  const { tiler, template } = await tiled([circleAt('a', OX + 128, OY + 128, 40)]);
  const tile = await fetchTile(template(), Z, TX, TY);
  assert.deepEqual(tile.draws.map((d) => d.kind), ['fill', 'stroke']);
  assert.equal(tile.draws[0].ops[0][0], 'A', 'drawn as an arc where it is round');
  const pixels = rasterize(tile);
  assert.equal(pixels.get('128,128'), FILL);
  assert.equal(pixels.get('110,128'), FILL);
  // The ring at x = 168: the 4-px line covers 166..169.
  assert.equal(pixels.get('167,128'), STROKE);
  assert.equal(pixels.get('168,128'), STROKE);
  assert.equal(pixels.get('88,128'), STROKE);
  assert.equal(pixels.get('128,88'), STROKE);
  assert.equal(pixels.get('128,167'), STROKE);
  assert.equal(pixels.has('171,128'), false);
  assert.deepEqual(colsAt(pixels, 128), [86, 169]);
  await tiler.clear();
});

test('タイル境界をまたぐ円は両側のタイルで同じ位置・大きさで欠けずに出る', async () => {
  // Centre 6 px left of the right edge, 30 px radius: most of it is in the next tile.
  const { tiler, template } = await tiled([circleAt('across', OX + 250, OY + 100, 30)]);
  const left = rasterize(await fetchTile(template(), Z, TX, TY));
  const right = rasterize(await fetchTile(template(), Z, TX + 1, TY));
  // Row 100 runs 220-2 .. 280+1 in world pixels: 218..255 on the left, 0..25 on the right.
  assert.deepEqual(colsAt(left, 100), [218, 255]);
  assert.deepEqual(colsAt(right, 100), [0, 25]);
  // Every row the circle covers is in both tiles, the same rows.
  for (let y = 72; y <= 128; y++) {
    const l = colsAt(left, y), r = colsAt(right, y);
    assert.ok(l && r, `row ${y} in both tiles`);
    assert.equal(l[1], 255, `row ${y} reaches the left tile's edge`);
    assert.equal(r[0], 0, `row ${y} starts at the right tile's edge`);
    // Symmetric round the centre (x = 250.5 in pixel centres of the left tile, 256 + -5.5 on the right).
    assert.ok(Math.abs((l[0] + (r[1] + 256)) / 2 - 250) <= 1, `row ${y} centred: ${l[0]}..${r[1] + 256}`);
  }
  // The circle below the tile edge too: centre on the bottom edge.
  const { tiler: t2, template: tpl2 } = await tiled([circleAt('down', OX + 60, OY + 255, 20)]);
  const top = rasterize(await fetchTile(tpl2(), Z, TX, TY));
  const below = rasterize(await fetchTile(tpl2(), Z, TX, TY + 1));
  assert.ok(colsAt(top, 255));
  assert.ok(colsAt(below, 0));
  assert.deepEqual(colsAt(below, 0), colsAt(top, 255), 'the rows on either side of the edge are as wide');
  await tiler.clear();
  await t2.clear();
});

test('z と z+1 で半径の画素数は 2 倍（地上の大きさが保たれる）、縁幅は同じ', async () => {
  const { tiler, template } = await tiled([circleAt('a', OX + 60, OY + 60, 30)]);
  const atZ = rasterize(await fetchTile(template(), Z, TX, TY));
  // At z+1 the centre is at world (120, 120) of tile (2TX, 2TY).
  const atZ1 = rasterize(await fetchTile(template(), Z + 1, TX * 2, TY * 2));
  const [a0, a1] = colsAt(atZ, 60);
  const [b0, b1] = colsAt(atZ1, 120);
  // Across, outline included: 2r + 4 at z, 4r + 4 at z+1.
  assert.equal(a1 - a0 + 1, 2 * 30 + 4);
  assert.equal(b1 - b0 + 1, 2 * 60 + 4);
  // The outline is 4 px wide at both (2 crossings in the centre row).
  assert.equal(countIn(atZ, 60, STROKE), 8);
  assert.equal(countIn(atZ1, 120, STROKE), 8);
  // @2x: twice the device pixels for the same circle.
  const hi = await fetchTile(template(), Z, TX, TY, 2);
  assert.equal(hi.width, 512);
  const [c0, c1] = colsAt(rasterize(hi), 120);
  assert.equal(c1 - c0 + 1, 2 * (2 * 30 + 4));
  await tiler.clear();
});

test('直径 1 px 未満は 1 px の点、直径 4 px 未満は縁を描かない', async () => {
  const { tiler, template } = await tiled([
    circleAt('dot', OX + 50.3, OY + 60.7, 0.2),
    circleAt('small', OX + 150, OY + 150, 1.5),
    circleAt('nofill', OX + 200, OY + 30, 0.3, { fillColor: 'transparent' }),
  ]);
  const tile = await fetchTile(template(), Z, TX, TY);
  const rects = tile.draws.filter((d) => d.kind === 'rect');
  assert.deepEqual(rects.map((d) => [d.color, ...d.rect]), [[FILL, 50, 60, 1, 1], [STROKE, 200, 30, 1, 1]], 'a pixel, the fill or else the outline colour');
  const small = tile.draws.filter((d) => d.kind !== 'rect');
  assert.deepEqual(small.map((d) => d.kind), ['fill'], 'no outline round a 3 px circle');
  assert.equal(small[0].ops[0][3], 1.5);
  await tiler.clear();
});

test('高緯度（70°、半径 200 km）は Ring: ネイティブと同じ circleToRing の点が通る画素に縁がある', async () => {
  const center = p(70, 20);
  const state = createCircleState({ id: 'big', center, radiusMeters: 200_000, fillColor: FILL, strokeColor: STROKE, strokeWidth: 4, zIndex: 0 });
  // At z3 the whole ring is in one tile, about 30 px round.
  const z = 3;
  // Mercator stretches the north side: the radii on screen differ by more than the arc's 0.25 px.
  const [cx, cy] = toPixel(center, z);
  const ring = circleToRing(center, 200_000, true, 128).map((pt) => toPixel(pt, z));
  const ys = ring.map((q) => q[1]);
  const ryN = cy - Math.min(...ys), ryS = Math.max(...ys) - cy;
  assert.ok(ryN - ryS > 1, `north ${ryN.toFixed(2)} px vs south ${ryS.toFixed(2)} px`);

  const { tiler, template } = await tiled([state]);
  const tx = Math.floor(cx / 256), ty = Math.floor(cy / 256);
  const tile = await fetchTile(template(), z, tx, ty);
  assert.equal(tile.draws[0].ops[0][0], 'M', 'drawn as the ring, not an arc');
  const pixels = rasterize(tile);
  let checked = 0;
  for (const [x, y] of ring) {
    const lx = Math.floor(x - tx * 256), ly = Math.floor(y - ty * 256);
    if (lx < 0 || ly < 0 || lx > 255 || ly > 255) continue;
    assert.equal(pixels.get(lx + ',' + ly), STROKE, `ring point ${x.toFixed(1)},${y.toFixed(1)}`);
    checked++;
  }
  assert.ok(checked > 20, `ring points in the tile: ${checked}`);
  assert.equal(pixels.get(`${Math.floor(cx - tx * 256)},${Math.floor(cy - ty * 256)}`) ?? FILL, FILL);
  await tiler.clear();
});

test('tile-sw.js の circleToRing は core と同じ点を返す', () => {
  for (const [lat, lng, r, geodesic] of [[42.35, -71.06, 12, true], [70, 20, 200_000, true], [-33.9, 151.2, 5_000, false], [0, 179.5, 30_000, true]]) {
    const core = circleToRing(p(lat, lng), r, geodesic, 128);
    const sw = swContext.circleToRing(lat, lng, r, geodesic);
    assert.equal(sw.length, core.length * 2);
    core.forEach((q, i) => {
      assert.ok(Math.abs(sw[i * 2] - q.latitude) < 1e-12, `lat ${i}`);
      assert.ok(Math.abs(sw[i * 2 + 1] - q.longitude) < 1e-12, `lng ${i}`);
    });
  }
});

test('描く順は zIndex（null は自動 zIndex: 南が上）、同じなら渡した順', async () => {
  const { tiler, template } = await tiled([
    circleAt('top', OX + 100, OY + 100, 20, { zIndex: 1, fillColor: 'rgba(255,0,0,1)', strokeWidth: 0 }),
    circleAt('bottom', OX + 110, OY + 100, 20, { zIndex: 0, fillColor: 'rgba(0,0,255,1)', strokeWidth: 0 }),
    circleAt('later', OX + 120, OY + 100, 20, { zIndex: 0, fillColor: 'rgba(0,255,0,1)', strokeWidth: 0 }),
    // No zIndex: the automatic one; the southern circle on top whichever comes first.
    circleAt('auto-south', OX + 100, OY + 200, 20, { zIndex: null, fillColor: 'rgba(1,1,1,1)', strokeWidth: 0 }),
    circleAt('auto-north', OX + 100, OY + 190, 20, { zIndex: null, fillColor: 'rgba(2,2,2,1)', strokeWidth: 0 }),
  ]);
  const tile = await fetchTile(template(), Z, TX, TY);
  assert.deepEqual(tile.draws.map((d) => d.color), ['rgba(2,2,2,1)', 'rgba(1,1,1,1)', 'rgba(0,0,255,1)', 'rgba(0,255,0,1)', 'rgba(255,0,0,1)']);
  const pixels = rasterize(tile);
  assert.equal(pixels.get('105,100'), 'rgba(255,0,0,1)');
  assert.equal(pixels.get('125,100'), 'rgba(0,255,0,1)');
  assert.equal(pixels.get('100,195'), 'rgba(1,1,1,1)');
  await tiler.clear();
});

test('透明色・縁幅 0 は描かず、何も無いタイルは「空」（透明の PNG）', async () => {
  const { tiler, template } = await tiled([
    circleAt('t1', OX + 100, OY + 100, 20, { fillColor: 'transparent', strokeColor: 'rgba(0,0,0,0)' }),
    circleAt('t2', OX + 100, OY + 100, 20, { fillColor: '#ff000000', strokeColor: '#f000' }),
    circleAt('t3', OX + 100, OY + 100, 20, { fillColor: 'transparent', strokeWidth: 0 }),
  ]);
  assert.deepEqual(await fetchTile(template(), Z, TX, TY), { empty: true });
  assert.deepEqual(await fetchTile(template(), Z, TX + 10, TY + 10), { empty: true });
  await tiler.clear();
});

// ── コントローラ経由: その場の変更 ──────────────────────────────────────────────

test('tiled compositions allocate no persistent entities or fingerprints', async () => {
  const { controller } = setup();
  const states = Array.from({ length: 2001 }, (_, i) => createCircleState({
    id: `shared-${i}`, center: p(0.001 * i, 0), radiusMeters: 5,
  }));
  let fingerprints = 0;
  for (const state of states) {
    const original = state.fingerPrint;
    state.fingerPrint = () => { fingerprints++; return original(); };
  }
  try {
    await controller.add(states);
    assert.equal(fingerprints, 0);
    const manager = controller.circleManager;
    assert.equal(manager.nativeEntities().length, 0);
    assert.equal(manager.hasEntity('shared-123'), true);
    assert.equal(manager.getEntity('shared-123').state, states[123]);
    assert.equal(manager.find(states[123].center).state, states[123]);
    assert.equal(manager.nativeEntities().length, 0);
    const replacement = states[25].copy({ radiusMeters: 8 });
    await controller.update(replacement);
    assert.equal(manager.getEntity('shared-25').state, replacement);
    controller.tiler.remove('shared-123');
    assert.equal(manager.hasEntity('shared-123'), false);
    assert.equal(manager.getEntity('shared-123'), null);
  } finally { await controller.clear(); }
});

test('revision readers independently receive changes and accept equal replacement states', async () => {
  const a = setup({ enabled: false, minCircleCount: 3 });
  const b = setup({ enabled: false, minCircleCount: 3 });
  const state = circleAt('shared-native', OX + 100, OY + 100, 10);
  try {
    await a.controller.add([state]); await b.controller.add([state]);
    const revision = state.revision;
    state.radiusMeters += 1;
    assert.ok(state.revision > revision);
    assert.ok(state.changedFields & 2);
    await a.controller.update(state); await b.controller.update(state);
    assert.equal(a.native.changed.length, 1); assert.equal(b.native.changed.length, 1);
    await a.controller.update(state);
    assert.equal(a.native.changed.length, 1);
    await a.controller.add([state.copy()]);
    assert.equal(a.native.changed.length, 1);
  } finally { await a.controller.clear(); await b.controller.clear(); }
});

function setup(options = { enabled: true, minCircleCount: 3 }) {
  const native = { added: [], changed: [], removed: [] };
  const renderer = {
    async onAdd(data) { return data.map(({ state }) => (native.added.push(state.id), { native: state.id })); },
    async onChange(data) { return data.map(({ current }) => (native.changed.push(current.state.id), { native: current.state.id })); },
    async onRemove(data) { for (const e of data) native.removed.push(e.state.id); },
    async onPostProcess() {},
  };
  class Controller extends CircleController {}
  const controller = new Controller({ circleManager: new CircleManager(), renderer });
  const tiler = new CircleTiler(options);
  let template = null;
  tiler.onTemplate = (t) => { template = t; };
  controller.tiler = tiler;
  return { controller, tiler, native, template: () => template };
}

function circles() {
  return [
    circleAt('a', OX + 40, OY + 40, 20, { fillColor: 'rgba(255,0,0,1)', strokeWidth: 0 }),
    circleAt('b', OX + 128, OY + 128, 20, { fillColor: 'rgba(0,255,0,1)', strokeWidth: 0 }),
    circleAt('c', OX + 200, OY + 200, 20, { fillColor: 'rgba(0,0,255,1)', strokeWidth: 0 }),
    circleAt('far', OX + 2560 + 100, OY + 40, 20, { fillColor: 'rgba(255,255,0,1)', strokeWidth: 0 }),
  ];
}
const colorsOf = (tile) => (tile.empty ? [] : tile.draws.map((d) => d.color).sort());

test('色を変えたら触れたタイルだけ描き直し、版が上がる（ネイティブには渡さない）', async () => {
  const { controller, tiler, native, template } = setup();
  const list = circles();
  await controller.add(list);
  assert.deepEqual(native.added, []);
  const first = template();
  await fetchTile(template(), Z, TX, TY);
  await fetchTile(template(), Z, TX + 10, TY);
  const before = renders.count;

  list[0].fillColor = 'rgba(9,9,9,1)';
  await controller.update(list[0]);
  await settle();
  assert.notEqual(template(), first, 'a new version in the URL');
  assert.match(template(), /\/256\/2\//);
  assert.equal(messages.at(-1), 'sw-update-circles', 'no full re-registration');
  assert.deepEqual(colorsOf(await fetchTile(template(), Z, TX, TY)), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)', 'rgba(9,9,9,1)']);
  assert.equal(renders.count, before + 1, 'the touched tile is drawn again');
  assert.deepEqual(colorsOf(await fetchTile(template(), Z, TX + 10, TY)), ['rgba(255,255,0,1)']);
  assert.equal(renders.count, before + 1, 'the other one comes from the cache');
  assert.equal(tiler.isTiled('a'), true);
  assert.deepEqual(native.added, []);
  await controller.clear();
});

test('その場で日付変更線へ動かしたらネイティブへ移り、タイルから消え、onAdded は呼ばない', async () => {
  const { controller, tiler, native, template } = setup();
  const list = circles();
  const added = [];
  for (const s of list) s.onAdded = (state) => added.push(state.id);
  await controller.add(list);
  assert.deepEqual(added.sort(), ['a', 'b', 'c', 'far'], 'once each, in tiles');
  added.length = 0;

  list[0].center = p(0, 179.9999999);
  await controller.update(list[0]);
  await settle();
  assert.deepEqual(native.added, ['a'], 'the map SDK draws it now');
  assert.equal(tiler.isTiled('a'), false);
  assert.equal(controller.circleManager.getEntity('a').circle?.native, 'a');
  assert.deepEqual(colorsOf(await fetchTile(template(), Z, TX, TY)), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)']);

  // The same list again: still on the map, natively now; nothing added or removed.
  await controller.add(list);
  assert.deepEqual(native.added, ['a']);
  assert.deepEqual(native.removed, []);
  assert.deepEqual(added, []);
  await controller.clear();
});

test('混在リスト: 描けない円だけネイティブ、ほかはタイル。しきい値未満なら全部ネイティブ。タップはどちらも', async () => {
  const { controller, tiler, native } = setup();
  const list = circles();
  const pole = createCircleState({ id: 'pole', center: p(89.5, 0), radiusMeters: 1000 });
  await controller.add([...list, pole]);
  assert.deepEqual(native.added, ['pole']);
  assert.equal(tiler.isTiled('a'), true);
  assert.equal(controller.circleManager.getEntity('a').circle, null, 'a tiled circle has no native object');
  await controller.onCameraChanged({ zoom: Z });
  assert.equal(controller.find(atPixel(OX + 41, OY + 41, Z))?.state.id, 'a');
  assert.equal(controller.find(p(89.5, 0))?.state.id, 'pole');
  await controller.clear();
  assert.deepEqual(native.removed, ['pole'], 'clear hands the renderer only the native ones');

  const few = setup({ enabled: true, minCircleCount: 100 });
  await few.controller.add(circles());
  assert.deepEqual(few.native.added, ['a', 'b', 'c', 'far']);
  assert.equal(few.template(), null);
  await few.controller.clear();
});

test('options は差し替えられ、次の route で決め直す', async () => {
  const { controller, tiler, native } = setup();
  const list = circles();
  const added = [];
  for (const s of list) s.onAdded = (state) => added.push(state.id);
  await controller.add(list);
  assert.equal(tiler.isTiled('a'), true);
  tiler.options = CircleTilingOptions.Disabled;
  await controller.add([]);
  await controller.add(list);
  assert.equal(tiler.isTiled('a'), false);
  assert.deepEqual(native.added, ['a', 'b', 'c', 'far']);
  assert.deepEqual(added.sort(), ['a', 'a', 'b', 'b', 'c', 'c', 'far', 'far'], 'removed and added again: onAdded again');
  await controller.clear();
});

// ── タップは近くのタイルの円だけを読む（ios-sdk の CircleTilingInPlaceTests、android-sdk の CircleTilerDeviceTest と対） ──

test('タップは今の state で決める。位置を変えた直後、タイルの描き直しより前でも', async () => {
  const { controller } = setup();
  const list = circles();
  await controller.add(list);
  const before = list[3].center;
  const moved = p(list[0].center.latitude - 0.01, list[0].center.longitude);
  list[3].center = moved;
  await controller.update(list[3]);
  assert.equal(controller.find(moved)?.state.id, 'far');
  assert.equal(controller.find(before), null);
  await settle();
  assert.equal(controller.find(moved)?.state.id, 'far');
  assert.equal(controller.find(before), null);
  await controller.clear();
});

test('縁の半分は半径の外まで当たる。半径より太い縁、描かない（透明な）縁でも', async () => {
  const { controller } = setup();
  const list = circles();
  for (const state of list) {
    state.radiusMeters = 5;
    state.strokeWidth = 40;
    state.strokeColor = 'rgba(255,0,0,1)';
  }
  list[0].strokeColor = 'transparent';
  await controller.add(list);
  const center = list[0].center;
  await controller.onCameraChanged({ position: center, zoom: 18, bearing: 0, tilt: 0 });
  const half = (calculateMetersPerPixel({ latitude: center.latitude, zoom: 18 }) * 40) / 2;
  const onStroke = computeOffset({ origin: center, distance: 5 + half - 0.5, heading: 270 });
  const beyond = computeOffset({ origin: center, distance: 5 + half + 0.5, heading: 270 });
  assert.equal(controller.find(onStroke)?.state.id, 'a');
  assert.equal(controller.find(beyond), null);
  await controller.clear();
});

test('タップは近くの円だけを読む。全国の例の規模で全部を読むと 1 回数十 ms かかっていた', async () => {
  const { controller } = setup();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const list = Array.from({ length: 100_000 }, (_, i) => createCircleState({
    id: `c${i}`, center: p(30 + rnd() * 15, 130 + rnd() * 15), radiusMeters: 500, strokeWidth: 1, onClick: () => {},
  }));
  await controller.add(list);
  await controller.onCameraChanged({ position: list[0].center, zoom: 12, bearing: 0, tilt: 0 });
  const start = performance.now();
  for (const state of list.slice(0, 10)) assert.ok(controller.find(state.center));
  const perTap = (performance.now() - start) / 10;
  assert.ok(perTap < 2, `a tap took ${perTap.toFixed(2)} ms`);
  await controller.clear();
});
