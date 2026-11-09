import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateMetersPerPixel, createGeoPoint, createPolylineEntity, createPolylineState, Planar, PolylineManager } from '../dist/index.mjs';

/**
 * ポリラインのタップ判定（core の PolylineManager.find。タイルでもネイティブでも同じ）。
 *
 * android-sdk の `PolylineHitToleranceTest`、ios-sdk の `PolylineHitToleranceTests` と 1 対 1 で対応する。
 *
 * - あたる距離は「指の大きさ（24 CSS px）＋ 線幅/2」。太い線は縁から指の大きさ以内であたる。
 * - 複数あたれば最も近い線。clickable=false は透過する。
 * - 外接矩形で遠い線を飛ばしても結果は変わらない（5 万本を毎タップ全部なめないための近道）。
 */

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const ZOOM = 16;
const LAT = 42.355;
const LNG = -71.06;
const MPP = calculateMetersPerPixel({ latitude: LAT, zoom: ZOOM });
const DEG_PER_M_LAT = 1 / 111_132.954;
/** A point `px` CSS pixels north of (LAT, lng) at ZOOM. */
const north = (px, lng = LNG) => p(LAT + px * MPP * DEG_PER_M_LAT, lng);
const camera = { zoom: ZOOM };

function managerWith(...states) {
  const manager = new PolylineManager();
  for (const state of states) manager.registerEntity(createPolylineEntity({ state, polyline: null }));
  return manager;
}
const eastWest = (id, extra = {}) =>
  createPolylineState({ id, points: [p(LAT, LNG - 0.01), p(LAT, LNG + 0.01)], strokeWidth: 1, ...extra });

test('細い線: 指の大きさ（24 px）の内側はあたり、外はあたらない', () => {
  const manager = managerWith(eastWest('thin', { strokeWidth: 2 }));
  // 24 + 2/2 = 25 px
  assert.equal(manager.find(north(24.5), camera)?.entity.state.id, 'thin');
  assert.equal(manager.find(north(25.6), camera), null);
});

test('太い線: 線幅/2 + 指の大きさまであたる', () => {
  const manager = managerWith(eastWest('wide', { strokeWidth: 40 }));
  // 24 + 40/2 = 44 px
  assert.equal(manager.find(north(43), camera)?.entity.state.id, 'wide');
  assert.equal(manager.find(north(45), camera), null);
  // 返す点は線上の最近点（タップ点ではない）
  const hit = manager.find(north(30), camera);
  assert.ok(Math.abs(hit.closestPoint.latitude - LAT) < 1e-9);
});

test('複数あたれば最も近い線。clickable=false は透過する', () => {
  const near = createPolylineState({ id: 'near', points: [north(10, LNG - 0.01), north(10, LNG + 0.01)], strokeWidth: 30 });
  const far = createPolylineState({ id: 'far', points: [north(-10, LNG - 0.01), north(-10, LNG + 0.01)], strokeWidth: 2 });
  const manager = managerWith(far, near);
  assert.equal(manager.find(north(6), camera)?.entity.state.id, 'near');
  assert.equal(manager.find(north(-6), camera)?.entity.state.id, 'far');
  near.clickable = false;
  assert.equal(manager.find(north(6), camera)?.entity.state.id, 'far');
});

test('外接矩形の事前判定で結果が変わらない（総当たりと同じ答え）', () => {
  // Short random lines around Boston, varied widths, against a brute force over every segment.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const states = [];
  for (let i = 0; i < 400; i++) {
    const lat = LAT + (rand() - 0.5) * 0.02;
    const lng = LNG + (rand() - 0.5) * 0.02;
    const points = [p(lat, lng)];
    for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) {
      points.push(p(points.at(-1).latitude + (rand() - 0.5) * 0.001, points.at(-1).longitude + (rand() - 0.5) * 0.001));
    }
    states.push(createPolylineState({ id: `l${i}`, points, strokeWidth: 1 + rand() * 20 }));
  }
  const manager = managerWith(...states);
  const brute = (position) => {
    let best = null;
    let bestDist = Infinity;
    const mpp = calculateMetersPerPixel({ latitude: position.latitude, zoom: ZOOM });
    for (const state of states) {
      if (state.geodesic) continue;
      const threshold = mpp * (24 + state.strokeWidth / 2);
      for (let i = 0; i < state.points.length - 1; i++) {
        const r = Planar.pointOnLineOrNull({ from: state.points[i], to: state.points[i + 1], position, thresholdMeters: threshold });
        if (r && r[1] < bestDist) { bestDist = r[1]; best = state.id; }
      }
    }
    return best;
  };
  let hits = 0;
  for (let t = 0; t < 600; t++) {
    const position = p(LAT + (rand() - 0.5) * 0.022, LNG + (rand() - 0.5) * 0.022);
    const want = brute(position);
    const got = manager.find(position, camera)?.entity.state.id ?? null;
    if (want) hits++;
    assert.equal(got, want, `tap ${t}`);
  }
  assert.ok(hits > 50, `${hits} taps hit something`);
});

test('点を差し替えたら外接矩形も作り直す', () => {
  const state = eastWest('moved', { strokeWidth: 2 });
  const manager = managerWith(state);
  assert.equal(manager.find(north(0), camera)?.entity.state.id, 'moved');
  state.points = [p(LAT + 0.01, LNG - 0.01), p(LAT + 0.01, LNG + 0.01)];
  manager.registerEntity(createPolylineEntity({ state, polyline: null }));
  assert.equal(manager.find(north(0), camera), null);
  assert.equal(manager.find(p(LAT + 0.01, LNG), camera)?.entity.state.id, 'moved');
});

test('geodesic の線も外接矩形（測地線のふくらみ込み）で取りこぼさない', () => {
  // A long east-west geodesic bulges north of its ends; tap on the bulge.
  const state = createPolylineState({ id: 'g', points: [p(60, -60), p(60, 60)], geodesic: true, strokeWidth: 2 });
  const manager = managerWith(state);
  const bulge = createPolylineEntity({ state, polyline: null }).bounds.northEast.latitude;
  assert.ok(bulge > 70, `${bulge}`);
  // The geodesic crosses longitude 0 at its northernmost point.
  assert.equal(manager.find(p(bulge, 0), { zoom: 3 })?.entity.state.id, 'g');
});
