import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

/**
 * ポリラインのタイル化（PolylineTiler / PolylineTileSet / tile-sw.js の Shape tiles）。
 *
 * android-sdk の `PolylineTilingTest`、ios-sdk の `PolylineTilingTests` と 1 対 1 で対応する。
 *
 * ## なぜここを固定するか
 *
 * タイルで描いた線は、地図 SDK が描く線と「同じ所に同じ太さで」出なければならない。
 * 崩れ方はどれも画面で見てやっと分かる種類のもの:
 * - 線幅をズームの単位で持つと、ズームのたびに太さが変わる（線幅は画面上の CSS px）。
 * - 候補を引く範囲を線幅ぶん広げないと、タイルの端をかすめる太い線が隣のタイルで欠ける。
 * - 線をタイルの中だけ描くと、境目で端の丸みが付いて線が切れて見える。
 * - 1 px 未満に潰れた線を捨てると、引いた地図で細い道が消える（点で残す）。
 *
 * 経路は本物を通す: PolylineController → PolylineTiler → PolylineTileSet → LocalTileServer →
 * tile-sw.js（vm で動かす）。タイルの中身は、偽の OffscreenCanvas が記録した線（moveTo/lineTo・
 * 線幅）と点（arc）を、ここで画素に塗って見る: 画素の中心が線から線幅/2 以内なら塗られる
 * （丸い端・丸い角のキャンバスと同じ形。アンチエイリアスは見ない）。
 */

// ── tile-sw.js を vm で動かす。描いた線と点を記録する ──────────────────────────
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
      stroke(path) { canvas.draws.push({ kind: 'stroke', color: this.strokeStyle, width: this.lineWidth, cap: this.lineCap, ops: path.ops }); },
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
const swContext = vm.createContext({
  self: { addEventListener: (name, handler) => { handlers[name] = handler; }, clients: {} },
  console: { log() {}, debug() {}, warn() {}, error() {} },
  OffscreenCanvas: Canvas, Path2D, Blob, Response, URL, setTimeout, clearTimeout,
});
vm.runInContext(worker, swContext);

const PNG_SIGNATURE = [137, 80, 78, 71];

/**
 * One tile as the map asks for it. `{ empty: true }` for the worker's empty
 * tile (a transparent PNG), else what the fake canvas recorded.
 */
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
    if (d.kind === 'stroke') {
      const segments = [];
      let last = null;
      for (const op of d.ops) {
        if (op[0] === 'M') last = [op[1], op[2]];
        else if (op[0] === 'L') { segments.push([last, [op[1], op[2]]]); last = [op[1], op[2]]; }
      }
      const half = d.width / 2;
      paint((x, y) => segments.some(([a, b]) => distanceToSegment(x, y, a, b) <= half), d.color);
    } else if (d.kind === 'fill') {
      for (const op of d.ops) {
        if (op[0] === 'A') paint((x, y) => Math.hypot(x - op[1], y - op[2]) <= op[3], d.color);
      }
    }
  }
  return pixels;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The rows painted in column `x`, as [first, last], or null. */
function rowsAt(pixels, x) {
  const rows = [];
  for (const key of pixels.keys()) {
    const [px, py] = key.split(',').map(Number);
    if (px === x) rows.push(py);
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a - b);
  assert.equal(rows.at(-1) - rows[0] + 1, rows.length, `rows of column ${x} are not contiguous: ${rows}`);
  return [rows[0], rows.at(-1)];
}

// ── ページ側: service worker の代わりに上の vm へ渡す ─────────────────────────
const messages = [];
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
          handlers.message({ data, ports });
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
  createPolylineState,
  PolylineController,
  PolylineManager,
  PolylineTiler,
  PolylineTileSet,
  PolylineTilingOptions,
  POLYLINE_TILE_LAYER_ID,
  polylineTileRasterLayerState,
} = await import('../dist/index.mjs');

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const settle = () => new Promise((r) => setTimeout(r, 40)); // tile updates coalesce for 16 ms

/** The point at world pixel (wx, wy) of zoom z (256-px tiles). */
function atPixel(wx, wy, z) {
  const scale = 256 * 2 ** z;
  const longitude = (wx / scale) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / scale))) * 180) / Math.PI;
  return p(latitude, longitude);
}

// A tile in Boston at z16; lines are placed in its world pixels.
const Z = 16, TX = 19824, TY = 24247;
const OX = TX * 256, OY = TY * 256;
const line = (id, points, extra = {}) =>
  createPolylineState({ id, points, strokeColor: 'rgba(255,0,0,1)', strokeWidth: 4, ...extra });

/** Tiles `states` (every one, whatever the count) and resolves to the template. */
async function tiled(states) {
  const tiler = new PolylineTiler({ enabled: true, minPolylineCount: 1, minVertexCount: 1e9 });
  let template = null;
  tiler.onTemplate = (t) => { template = t; };
  const ids = await tiler.route(states);
  assert.equal(ids.size, states.filter((s) => PolylineTileSet.canTile(s)).length);
  return { tiler, template: () => template };
}

test('しきい値: 本数か頂点数のどちらかが届けばタイル。判定はここ 1 か所', () => {
  const o = PolylineTilingOptions.Default;
  assert.equal(o.minPolylineCount, 2000);
  assert.equal(o.minVertexCount, 50_000);
  assert.equal(PolylineTilingOptions.shouldUseTiles(o, 1999, 49_999), false);
  assert.equal(PolylineTilingOptions.shouldUseTiles(o, 2000, 0), true);
  assert.equal(PolylineTilingOptions.shouldUseTiles(o, 10, 50_000), true);
  assert.equal(PolylineTilingOptions.shouldUseTiles(PolylineTilingOptions.Disabled, 100_000, 1e7), false);
});

test('canTile: geodesic・1 点・経度の幅 180° 以上はタイルにしない（2 点からは描く）', () => {
  assert.equal(PolylineTileSet.canTile(line('a', [p(0, 0), p(1, 1)])), true);
  assert.equal(PolylineTileSet.canTile(line('a', [p(0, 0), p(1, 1)], { geodesic: true })), false);
  assert.equal(PolylineTileSet.canTile(line('a', [p(0, 0)])), false);
  assert.equal(PolylineTileSet.canTile(line('a', [p(0, -100), p(0, 80)])), false);
  assert.equal(PolylineTileSet.canTile(line('a', [p(0, -90), p(0, 89)])), true);
  assert.equal(PolylineTileSet.vertexCount([line('a', [p(0, 0), p(1, 1)]), line('b', [p(0, 0), p(1, 1), p(2, 2)])]), 5);
});

test('route はタイルにした id を返し、レイヤーは POLYLINE_TILE_LAYER_ID で版つきの URL', async () => {
  const states = [line('a', [atPixel(OX + 10, OY + 10, Z), atPixel(OX + 50, OY + 10, Z)]), line('g', [p(0, 0), p(1, 1)], { geodesic: true })];
  const { tiler, template } = await tiled(states);
  assert.equal(tiler.isTiled('a'), true);
  assert.equal(tiler.isTiled('g'), false);
  assert.deepEqual(tiler.tiledStates().map((s) => s.id), ['a']);
  assert.match(template(), /^\/__tiles\/polylines-[a-z0-9]+\/256\/1\/\{z\}\/\{x\}\/\{y\}\.png$/);
  const layer = polylineTileRasterLayerState(template());
  assert.equal(layer.id, POLYLINE_TILE_LAYER_ID);
  assert.equal(POLYLINE_TILE_LAYER_ID, 'mc-polyline-tiles');
  await tiler.clear();
  assert.equal(template(), null);
});

test('水平線は期待した行に、線幅ぶんの太さで出る', async () => {
  const { tiler, template } = await tiled([line('a', [atPixel(OX + 20, OY + 100, Z), atPixel(OX + 200, OY + 100, Z)])]);
  const pixels = rasterize(await fetchTile(template(), Z, TX, TY));
  // Width 4 around row 100: rows 98..101.
  assert.deepEqual(rowsAt(pixels, 100), [98, 101]);
  assert.deepEqual(rowsAt(pixels, 20), [98, 101]);
  // Round caps: half the width past each end, no further.
  assert.notEqual(rowsAt(pixels, 18), null);
  assert.equal(rowsAt(pixels, 16), null);
  assert.equal(rowsAt(pixels, 203), null);
  assert.equal(pixels.get('100,100'), 'rgba(255,0,0,1)');
  await tiler.clear();
});

test('タイル境界をまたぐ線は両側のタイルで同じ行・同じ太さで切れ目なく続く', async () => {
  const { tiler, template } = await tiled([
    // Across the right edge of the tile.
    line('across', [atPixel(OX + 200, OY + 60, Z), atPixel(OX + 256 + 100, OY + 60, Z)]),
    // Along the bottom edge, inside the tile: its lower half overhangs into the tile below.
    line('edge', [atPixel(OX + 20, OY + 254, Z), atPixel(OX + 120, OY + 254, Z)], { strokeWidth: 6, strokeColor: 'rgba(0,0,255,1)' }),
  ]);
  const left = rasterize(await fetchTile(template(), Z, TX, TY));
  const right = rasterize(await fetchTile(template(), Z, TX + 1, TY));
  assert.deepEqual(rowsAt(left, 255), [58, 61]);
  assert.deepEqual(rowsAt(right, 0), [58, 61]);
  assert.deepEqual(rowsAt(right, 99), [58, 61]);

  // Width 6 around row 254: world rows 251..256, the last one in the tile below.
  assert.deepEqual(rowsAt(left, 60), [251, 255]);
  const below = rasterize(await fetchTile(template(), Z, TX, TY + 1));
  assert.deepEqual(rowsAt(below, 60), [0, 0]);
  assert.equal(below.get('60,0'), 'rgba(0,0,255,1)');
  await tiler.clear();
});

test('z と z+1 で線幅（画素）は変わらない。@2x では倍の画素', async () => {
  const states = [line('a', [atPixel(OX + 20, OY + 100, Z), atPixel(OX + 120, OY + 100, Z)], { strokeWidth: 6 })];
  const { tiler, template } = await tiled(states);
  const atZ = rasterize(await fetchTile(template(), Z, TX, TY));
  // At z+1 the line is at world row 200 of the tile (2TX, 2TY).
  const atZ1 = rasterize(await fetchTile(template(), Z + 1, TX * 2, TY * 2));
  const [a0, a1] = rowsAt(atZ, 60);
  const [b0, b1] = rowsAt(atZ1, 120);
  assert.deepEqual([a0, a1], [97, 102]);
  assert.deepEqual([b0, b1], [197, 202], 'the same 6 rows, round the doubled position');

  const hi = await fetchTile(template(), Z, TX, TY, 2);
  assert.equal(hi.width, 512);
  const [c0, c1] = rowsAt(rasterize(hi), 120);
  assert.deepEqual([c0, c1], [194, 205], '12 device pixels at 2x');
  await tiler.clear();
});

test('1 px 未満に潰れる線は線幅の丸い点になる', async () => {
  const { tiler, template } = await tiled([
    line('short', [atPixel(OX + 100, OY + 100, Z), atPixel(OX + 100.3, OY + 100.2, Z)], { strokeWidth: 6 }),
  ]);
  const tile = await fetchTile(template(), Z, TX, TY);
  assert.equal(tile.draws.length, 1);
  assert.equal(tile.draws[0].kind, 'fill');
  const [op] = tile.draws[0].ops;
  assert.equal(op[0], 'A');
  assert.equal(op[3], 3, 'radius: half the line width');
  const pixels = rasterize(tile);
  assert.ok(pixels.has('100,100'));
  assert.ok(!pixels.has('100,104'));
  await tiler.clear();
});

test('描く順は zIndex、同じ zIndex なら渡した順', async () => {
  const horizontal = [atPixel(OX + 20, OY + 100, Z), atPixel(OX + 200, OY + 100, Z)];
  const vertical = [atPixel(OX + 100, OY + 20, Z), atPixel(OX + 100, OY + 200, Z)];
  const { tiler, template } = await tiled([
    line('top', horizontal, { zIndex: 1, strokeColor: 'rgba(255,0,0,1)' }),
    line('bottom', vertical, { zIndex: 0, strokeColor: 'rgba(0,0,255,1)' }),
    line('later', [atPixel(OX + 20, OY + 150, Z), atPixel(OX + 200, OY + 150, Z)], { zIndex: 0, strokeColor: 'rgba(0,255,0,1)' }),
  ]);
  const tile = await fetchTile(template(), Z, TX, TY);
  assert.deepEqual(tile.draws.map((d) => d.color), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)', 'rgba(255,0,0,1)']);
  const pixels = rasterize(tile);
  assert.equal(pixels.get('100,100'), 'rgba(255,0,0,1)', 'the higher zIndex is on top at the crossing');
  assert.equal(pixels.get('100,150'), 'rgba(0,255,0,1)');
  await tiler.clear();
});

test('透明色・線幅 0 の線は描かず、何も無いタイルは「空」（透明の PNG）', async () => {
  const at = [atPixel(OX + 20, OY + 100, Z), atPixel(OX + 200, OY + 100, Z)];
  const { tiler, template } = await tiled([
    line('t1', at, { strokeColor: 'transparent' }),
    line('t2', at, { strokeColor: 'rgba(0,0,0,0)' }),
    line('t3', at, { strokeColor: '#ff000000' }),
    line('t4', at, { strokeColor: '#f000' }),
    line('t5', at, { strokeWidth: 0 }),
  ]);
  assert.deepEqual(await fetchTile(template(), Z, TX, TY), { empty: true });
  // Far from every line.
  assert.deepEqual(await fetchTile(template(), Z, TX + 10, TY + 10), { empty: true });
  await tiler.clear();
});

// ── コントローラ経由: その場の変更 ──────────────────────────────────────────────

function setup(options = { enabled: true, minPolylineCount: 3, minVertexCount: 1e9 }) {
  const native = { added: [], changed: [], removed: [] };
  const renderer = {
    async onAdd(data) { return data.map(({ state }) => (native.added.push(state.id), { native: state.id })); },
    async onChange(data) { return data.map(({ current }) => (native.changed.push(current.state.id), { native: current.state.id })); },
    async onRemove(data) { for (const e of data) native.removed.push(e.state.id); },
    async onPostProcess() {},
  };
  class Controller extends PolylineController {}
  const controller = new Controller({ polylineManager: new PolylineManager(), renderer });
  const tiler = new PolylineTiler(options);
  let template = null;
  tiler.onTemplate = (t) => { template = t; };
  controller.tiler = tiler;
  return { controller, tiler, native, template: () => template };
}

// Three lines in the tile; one far away, in another tile.
function lines() {
  return [
    line('a', [atPixel(OX + 20, OY + 40, Z), atPixel(OX + 200, OY + 40, Z)], { strokeColor: 'rgba(255,0,0,1)' }),
    line('b', [atPixel(OX + 20, OY + 120, Z), atPixel(OX + 200, OY + 120, Z)], { strokeColor: 'rgba(0,255,0,1)' }),
    line('c', [atPixel(OX + 20, OY + 200, Z), atPixel(OX + 200, OY + 200, Z)], { strokeColor: 'rgba(0,0,255,1)' }),
    line('far', [atPixel(OX + 20 + 2560, OY + 40, Z), atPixel(OX + 200 + 2560, OY + 40, Z)], { strokeColor: 'rgba(255,255,0,1)' }),
  ];
}
const colorsOf = (tile) => (tile.empty ? [] : tile.draws.map((d) => d.color).sort());

test('色を変えたら触れたタイルだけ描き直し、版が上がる（ネイティブには渡さない）', async () => {
  const { controller, tiler, native, template } = setup();
  const list = lines();
  await controller.add(list);
  assert.deepEqual(native.added, []);
  const first = template();
  await fetchTile(template(), Z, TX, TY);
  await fetchTile(template(), Z, TX + 10, TY);
  const before = renders.count;

  list[0].strokeColor = 'rgba(9,9,9,1)';
  await controller.update(list[0]);
  await settle();
  assert.notEqual(template(), first, 'a new version in the URL');
  assert.match(template(), /\/256\/2\//);
  assert.equal(messages.at(-1), 'sw-update-polylines', 'no full re-registration');
  assert.deepEqual(colorsOf(await fetchTile(template(), Z, TX, TY)), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)', 'rgba(9,9,9,1)']);
  assert.equal(renders.count, before + 1, 'the touched tile is drawn again');
  assert.deepEqual(colorsOf(await fetchTile(template(), Z, TX + 10, TY)), ['rgba(255,255,0,1)']);
  assert.equal(renders.count, before + 1, 'the other one comes from the cache');
  assert.equal(tiler.isTiled('a'), true);
  assert.deepEqual(native.added, []);
  await controller.clear();
});

test('その場で geodesic にしたらネイティブへ移り、タイルから消え、onAdded は呼ばない', async () => {
  const { controller, tiler, native, template } = setup();
  const list = lines();
  const added = [];
  for (const s of list) s.onAdded = (state) => added.push(state.id);
  await controller.add(list);
  assert.deepEqual(added.sort(), ['a', 'b', 'c', 'far'], 'once each, in tiles');
  added.length = 0;

  list[0].geodesic = true;
  await controller.update(list[0]);
  await settle();
  assert.deepEqual(native.added, ['a'], 'the map SDK draws it now');
  assert.equal(tiler.isTiled('a'), false);
  assert.equal(controller.polylineManager.getEntity('a').polyline?.native, 'a');
  assert.deepEqual(colorsOf(await fetchTile(template(), Z, TX, TY)), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)']);

  // The same list again: still on the map, natively now; nothing added or removed.
  await controller.add(list);
  assert.deepEqual(native.added, ['a']);
  assert.deepEqual(native.removed, []);
  assert.deepEqual(added, []);
  await controller.clear();
});

test('混在リスト: geodesic だけネイティブ、ほかはタイル。しきい値未満なら全部ネイティブ', async () => {
  const { controller, tiler, native } = setup();
  const list = lines();
  const g = line('g', [atPixel(OX + 20, OY + 80, Z), atPixel(OX + 200, OY + 80, Z)], { geodesic: true });
  await controller.add([...list, g]);
  assert.deepEqual(native.added, ['g']);
  assert.equal(tiler.isTiled('a'), true);
  // Taps find tiled and native lines alike.
  const camera = { zoom: Z };
  await controller.onCameraChanged(camera);
  assert.equal(controller.find(atPixel(OX + 100, OY + 41, Z))?.state.id, 'a');
  assert.equal(controller.find(atPixel(OX + 100, OY + 81, Z))?.state.id, 'g');
  await controller.clear();

  const few = setup({ enabled: true, minPolylineCount: 100, minVertexCount: 1e9 });
  await few.controller.add(lines());
  assert.deepEqual(few.native.added, ['a', 'b', 'c', 'far']);
  assert.equal(few.template(), null);
  await few.controller.clear();
});

test('options は差し替えられ、次の route で決め直す', async () => {
  const { controller, tiler, native } = setup();
  const list = lines();
  const added = [];
  for (const s of list) s.onAdded = (state) => added.push(state.id);
  await controller.add(list);
  assert.equal(tiler.isTiled('a'), true);
  tiler.options = PolylineTilingOptions.Disabled;
  await controller.add([]);
  await controller.add(list);
  assert.equal(tiler.isTiled('a'), false);
  assert.deepEqual(native.added, ['a', 'b', 'c', 'far']);
  assert.deepEqual(added.sort(), ['a', 'a', 'b', 'b', 'c', 'c', 'far', 'far'], 'removed and added again: onAdded again');
  await controller.clear();
});
