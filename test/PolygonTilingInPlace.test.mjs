import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

/**
 * タイルにできないポリゴン（geodesic・経度の幅 180° 以上・頂点 3 未満）は地図 SDK が描く。
 *
 * ## なぜここを固定するか
 *
 * タイルにするかは add（新しいリスト）でだけ決めていた。タイルで描いているポリゴンを
 * その場で geodesic=true にしたり、点を書き換えてタイルにできない形にしたりすると、
 * update はタイルの経路に入ったまま canTile を見直さず、直線のままタイルに描き続けた。
 * update で canTile を満たさなくなったら、タイルから外して地図 SDK に描かせる。
 *
 * 経路は本物を通す: PolygonController → PolygonTiler → PolygonTileSet → LocalTileServer →
 * tile-sw.js（vm で動かす）。タイルの中身は偽の OffscreenCanvas が塗った色で見る。
 */

// ── tile-sw.js を vm で動かす。塗った色と描いた枚数を記録する ─────────────────
const renders = { count: 0 };
class Path2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
}
class Canvas {
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
    this.fills = [];
    if (width > 1) renders.count++; // the worker's 1x1 probe is not a tile
  }
  getContext() {
    const canvas = this;
    return {
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
      fill() { canvas.fills.push(this.fillStyle); },
      stroke() {},
      fillRect() { canvas.fills.push(this.fillStyle); },
    };
  }
  async convertToBlob() { return new Blob([JSON.stringify(this.fills)]); }
}

const worker = readFileSync(new URL('../dist/tile-sw.js', import.meta.url), 'utf8');
const handlers = {};
const swContext = vm.createContext({
  self: { addEventListener: (name, handler) => { handlers[name] = handler; }, clients: {} },
  console: { log() {}, debug() {}, warn() {}, error() {} },
  OffscreenCanvas: Canvas, Path2D, Blob, Response, URL, setTimeout, clearTimeout,
});
vm.runInContext(worker, swContext);

/** The fill colours of one polygon tile, served the way the map asks for it. */
async function tileFills(template, z, x, y) {
  const url = 'https://example.test' + template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  let response = null;
  handlers.fetch({ request: { url }, respondWith: (r) => { response = r; }, clientId: 'page' });
  assert.ok(response, `no answer for ${url}`);
  const res = await response;
  assert.equal(res.status, 200);
  const body = await res.arrayBuffer();
  return body.byteLength === 0 ? [] : JSON.parse(new TextDecoder().decode(body));
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
  createPolygonState,
  PolygonController,
  PolygonManager,
  PolygonTiler,
  PolygonTileSet,
} = await import('../dist/index.mjs');

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const settle = () => new Promise((r) => setTimeout(r, 40)); // tile updates coalesce for 16 ms

function square(id, lat, lng, fillColor, extra = {}) {
  const s = 0.002;
  return createPolygonState({
    id,
    points: [p(lat, lng), p(lat, lng + s), p(lat + s, lng + s), p(lat + s, lng)],
    fillColor,
    strokeColor: 'transparent',
    ...extra,
  });
}

/** z/x/y of the tile at a point. */
function tileAt(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { z, x, y };
}

function setup() {
  const native = { added: [], changed: [], removed: [] };
  const renderer = {
    async onAdd(data) { return data.map(({ state }) => (native.added.push(state.id), { native: state.id })); },
    async onChange(data) { return data.map(({ current }) => (native.changed.push(current.state.id), { native: current.state.id })); },
    async onRemove(data) { for (const e of data) native.removed.push(e.state.id); },
    async onPostProcess() {},
  };
  class Controller extends PolygonController {}
  const controller = new Controller({ polygonManager: new PolygonManager(), renderer });
  const tiler = new PolygonTiler({ enabled: true, minPolygonCount: 3, minVertexCount: 1e9 });
  let template = null;
  tiler.onTemplate = (t) => { template = t; };
  controller.tiler = tiler;
  return { controller, tiler, native, template: () => template };
}

// Four squares in central Tokyo, one tile at z14; one far away in Osaka.
const LAT = 35.68, LNG = 139.76;
function tokyo() {
  return [
    square('a', LAT, LNG, 'rgba(255,0,0,1)'),
    square('b', LAT, LNG + 0.003, 'rgba(0,255,0,1)'),
    square('c', LAT + 0.003, LNG, 'rgba(0,0,255,1)'),
    square('osaka', 34.69, 135.5, 'rgba(255,255,0,1)'),
  ];
}
const T = tileAt(LAT + 0.001, LNG + 0.001, 14);
const OSAKA = tileAt(34.691, 135.501, 14);

test('canTile: geodesic・経度の幅 180° 以上・頂点 3 未満はタイルにしない', () => {
  assert.equal(PolygonTileSet.canTile(square('x', 0, 0, 'red')), true);
  assert.equal(PolygonTileSet.canTile(square('x', 0, 0, 'red', { geodesic: true })), false);
  assert.equal(PolygonTileSet.canTile(createPolygonState({ points: [p(0, -100), p(0, 80), p(10, 0)] })), false);
  assert.equal(PolygonTileSet.canTile(createPolygonState({ points: [p(0, -90), p(0, 89), p(10, 0)] })), true);
  assert.equal(PolygonTileSet.canTile(createPolygonState({ points: [p(0, 0), p(1, 1)] })), false);
});

test('混在リストでは geodesic だけ地図 SDK が描き、タイルには入らない', async () => {
  const { controller, tiler, native, template } = setup();
  const list = tokyo();
  const g = square('g', LAT + 0.003, LNG + 0.003, 'rgba(255,0,255,1)', { geodesic: true });
  await controller.add([...list, g]);
  assert.deepEqual(native.added, ['g']);
  assert.equal(tiler.isTiled('g'), false);
  assert.equal(tiler.isTiled('a'), true);
  const fills = await tileFills(template(), T.z, T.x, T.y);
  assert.deepEqual(fills.sort(), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)', 'rgba(255,0,0,1)']);
  await controller.clear();
});

async function movesToNative(change) {
  const { controller, tiler, native, template } = setup();
  const list = tokyo();
  await controller.add(list);
  assert.deepEqual(native.added, [], 'all tiled at first');
  assert.ok((await tileFills(template(), T.z, T.x, T.y)).includes('rgba(255,0,0,1)'));
  await tileFills(template(), OSAKA.z, OSAKA.x, OSAKA.y);
  const rendersBefore = renders.count;

  const a = list[0];
  change(a);
  await controller.update(a);
  await settle();

  assert.deepEqual(native.added, ['a'], 'the map SDK draws it now');
  assert.equal(tiler.isTiled('a'), false);
  assert.equal(tiler.tiledStates().some((s) => s.id === 'a'), false);
  assert.equal(controller.polygonManager.getEntity('a').polygon?.native, 'a');
  // Tiles: gone from the one it was in; the others are still there.
  const fills = await tileFills(template(), T.z, T.x, T.y);
  assert.deepEqual(fills.sort(), ['rgba(0,0,255,1)', 'rgba(0,255,0,1)']);
  // Only the tiles it touched are drawn again: Osaka comes from the cache.
  const rendersAfterTokyo = renders.count;
  assert.equal(rendersAfterTokyo, rendersBefore + 1, 'the Tokyo tile is drawn again');
  assert.deepEqual(await tileFills(template(), OSAKA.z, OSAKA.x, OSAKA.y), ['rgba(255,255,0,1)']);
  assert.equal(renders.count, rendersAfterTokyo, 'the Osaka tile is not drawn again');
  assert.equal(messages.at(-1), 'sw-update-polygons', 'no full re-registration');
  return { controller, tiler, native, list };
}

test('その場で geodesic=true にしたら地図 SDK の描画へ移り、タイルから消える', async () => {
  const { controller, tiler, native, list } = await movesToNative((a) => { a.geodesic = true; });

  // Taps still find it, now drawn natively.
  const hit = controller.find(p(LAT + 0.001, LNG + 0.001));
  assert.equal(hit?.state.id, 'a');
  assert.equal(hit.polygon?.native, 'a');
  // And the tiled ones are still found.
  assert.equal(controller.find(p(LAT + 0.001, LNG + 0.004))?.state.id, 'b');

  // Further in-place changes go to the native polygon.
  list[0].fillColor = 'rgba(1,2,3,1)';
  await controller.update(list[0]);
  assert.deepEqual(native.changed, ['a']);

  // The same list again: it stays native, nothing is added or removed.
  await controller.add(list);
  assert.deepEqual(native.added, ['a']);
  assert.deepEqual(native.removed, []);
  assert.equal(tiler.isTiled('a'), false);
  await controller.clear();
});

test('その場で点を書き換えて経度の幅 180° 以上にしても地図 SDK の描画へ移る', async () => {
  const { controller } = await movesToNative((a) => {
    a.points = [p(LAT, LNG), p(LAT, LNG + 0.002), p(LAT + 0.002, LNG + 0.002), p(LAT + 0.002, -60)];
  });
  await controller.clear();
});

test('その場で点を 3 未満にしても地図 SDK の描画へ移る', async () => {
  const { controller } = await movesToNative((a) => {
    a.points = [p(LAT, LNG), p(LAT, LNG + 0.002)];
  });
  await controller.clear();
});

test('タイルにできる変更はタイルのまま（地図 SDK には渡さない）', async () => {
  const { controller, tiler, native, template } = setup();
  const list = tokyo();
  await controller.add(list);
  list[0].fillColor = 'rgba(9,9,9,1)';
  await controller.update(list[0]);
  await settle();
  assert.deepEqual(native.added, []);
  assert.equal(tiler.isTiled('a'), true);
  assert.ok((await tileFills(template(), T.z, T.x, T.y)).includes('rgba(9,9,9,1)'));
  await controller.clear();
});

test('タイルから地図 SDK の描画へ移っても onAdded は呼ばれない（地図に載ったまま）', async () => {
  const { controller, native } = setup();
  const list = tokyo();
  const added = [];
  for (const s of list) s.onAdded = (state) => added.push(state.id);
  await controller.add(list);
  assert.deepEqual(added.sort(), ['a', 'b', 'c', 'osaka'], 'once each, in tiles');
  added.length = 0;

  list[0].geodesic = true;
  await controller.update(list[0]);
  await settle();
  assert.deepEqual(native.added, ['a']);
  // The same list again: still on the map, natively now.
  await controller.add(list);
  assert.deepEqual(added, []);
  await controller.clear();
});

test('tiled zIndex changes reorder tiles even below the routing threshold', async () => {
  const {controller, template} = setup();
  const red = square('red', LAT, LNG, 'rgba(255,0,0,1)', {zIndex: 0});
  const blue = square('blue', LAT, LNG, 'rgba(0,0,255,1)', {zIndex: 1});
  const far = square('far', 34.69, 135.5, 'rgba(0,255,0,1)');
  try {
    await controller.add([red, blue, far]);
    assert.equal((await tileFills(template(), T.z, T.x, T.y)).at(-1), 'rgba(0,0,255,1)');
    far.geodesic = true;
    await controller.update(far);
    red.zIndex = 2;
    await controller.update(red);
    await settle();
    assert.equal((await tileFills(template(), T.z, T.x, T.y)).at(-1), 'rgba(255,0,0,1)');
    red.zIndex = 1;
    await controller.update(red);
    assert.equal((await tileFills(template(), T.z, T.x, T.y)).at(-1), 'rgba(0,0,255,1)');
  } finally { await controller.clear(); }
});
