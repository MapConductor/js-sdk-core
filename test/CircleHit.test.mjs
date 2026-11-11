import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculateMetersPerPixel,
  CircleController,
  CircleManager,
  computeDistanceBetween,
  createCircleEntity,
  createCircleState,
  createGeoPoint,
} from '../dist/index.mjs';

/**
 * 円のタップ判定（core の CircleManager.find。タイルでもネイティブでも同じ）。
 *
 * android-sdk の `CircleHitTest`、ios-sdk の `CircleHitTests` と 1 対 1 で対応する。
 *
 * - あたるのは中心からの球面距離が「半径 ＋ 縁幅/2（カメラのズームで CSS px → m）」以内。
 *   カメラが無ければ半径だけ。指の大きさは足さない（面はポリゴンと同じく中だけ）。
 * - 複数あたれば実効 zIndex（null は自動 zIndex）が最大のもの、同じなら中心が最も近いもの。
 * - clickable=false は透過する。
 * - 緯度差での事前判定で結果は変わらない。
 */

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const ZOOM = 16;
const LAT = 42.355;
const LNG = -71.06;
const MPP = calculateMetersPerPixel({ latitude: LAT, zoom: ZOOM });
const camera = { zoom: ZOOM };
/** Metres per degree of latitude on the sphere computeDistanceBetween measures on. */
const M_PER_DEG = (6378137 * Math.PI) / 180;
/** A point `metres` north of (LAT, LNG). */
const north = (metres, lng = LNG) => p(LAT + metres / M_PER_DEG, lng);

function managerWith(...states) {
  const manager = new CircleManager();
  for (const state of states) manager.registerEntity(createCircleEntity({ state, circle: null }));
  return manager;
}
const circle = (id, extra = {}) => createCircleState({ id, center: p(LAT, LNG), radiusMeters: 50, strokeWidth: 10, ...extra });

test('半径 ＋ 縁幅/2 の内側はあたり、外はあたらない', () => {
  const manager = managerWith(circle('c'));
  const reach = 50 + (10 / 2) * MPP; // 5 px of outline outside the ring
  assert.equal(manager.find(north(reach - 0.05), camera)?.state.id, 'c');
  assert.equal(manager.find(north(reach + 0.05), camera), null);
  // No finger tolerance: 24 px outside is a miss.
  assert.equal(manager.find(north(50 + 24 * MPP), camera), null);
});

test('カメラが無ければ半径だけ（縁幅は足さない）', () => {
  const manager = managerWith(circle('c'));
  assert.equal(manager.find(north(49.9))?.state.id, 'c');
  assert.equal(manager.find(north(50.1)), null);
  assert.equal(manager.find(north(50.1), null), null);
});

test('同じ zIndex なら中心が近いもの、zIndex が違えば大きいもの', () => {
  const a = circle('a', { center: north(-10), radiusMeters: 40, zIndex: 0 });
  const b = circle('b', { center: north(10), radiusMeters: 40, zIndex: 0 });
  const manager = managerWith(a, b);
  assert.equal(manager.find(north(-3), camera)?.state.id, 'a');
  assert.equal(manager.find(north(3), camera)?.state.id, 'b');
  // Insertion order does not decide a tie.
  assert.equal(managerWith(b, a).find(north(-3), camera)?.state.id, 'a');
  a.zIndex = 1;
  assert.equal(manager.find(north(3), camera)?.state.id, 'a', 'the higher zIndex wins over the nearer centre');
});

test('null の zIndex は自動 zIndex（南が上）で比べる', () => {
  const south = circle('south', { center: north(-10), radiusMeters: 40 });
  const northern = circle('north', { center: north(10), radiusMeters: 40 });
  const manager = managerWith(northern, south);
  // Nearer the northern centre, but the southern circle is on top.
  assert.equal(manager.find(north(5), camera)?.state.id, 'south');
});

test('clickable=false は透過する', () => {
  const top = circle('top', { zIndex: 2 });
  const under = circle('under', { zIndex: 1 });
  const manager = managerWith(top, under);
  assert.equal(manager.find(north(0), camera)?.state.id, 'top');
  top.clickable = false;
  assert.equal(manager.find(north(0), camera)?.state.id, 'under');
  under.clickable = false;
  assert.equal(manager.find(north(0), camera), null);
});

test('緯度の事前判定で結果が変わらない（総当たりと同じ答え）', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const states = [];
  for (let i = 0; i < 800; i++) {
    states.push(createCircleState({
      id: `c${i}`,
      center: p(LAT + (rand() - 0.5) * 0.01, LNG + (rand() - 0.5) * 0.01),
      radiusMeters: 1 + rand() * 60,
      strokeWidth: rand() * 8,
      zIndex: rand() < 0.5 ? null : Math.floor(rand() * 3),
    }));
  }
  const manager = managerWith(...states);
  const brute = (position) => {
    const mpp = calculateMetersPerPixel({ latitude: position.latitude, zoom: ZOOM });
    let best = null, bestZ = 0, bestD = Infinity;
    for (const s of states) {
      const d = computeDistanceBetween(s.center, position);
      if (d > s.radiusMeters + (mpp * s.strokeWidth) / 2) continue;
      const z = s.zIndex ?? ((-s.center.latitude * 1_000_000 - s.center.longitude) | 0);
      if (best == null || z > bestZ || (z === bestZ && d < bestD)) { best = s; bestZ = z; bestD = d; }
    }
    return best?.id ?? null;
  };
  let hits = 0;
  for (let k = 0; k < 600; k++) {
    const tap = p(LAT + (rand() - 0.5) * 0.011, LNG + (rand() - 0.5) * 0.011);
    const want = brute(tap);
    if (want) hits++;
    assert.equal(manager.find(tap, camera)?.state.id ?? null, want);
  }
  assert.ok(hits > 100, `enough taps hit something (${hits})`);
});

test('コントローラはカメラを覚え、縁幅をタップに入れる', async () => {
  const renderer = {
    async onAdd(data) { return data.map(() => ({})); },
    async onChange(data) { return data.map(() => ({})); },
    async onRemove() {},
    async onPostProcess() {},
  };
  const controller = new (class extends CircleController {})({ circleManager: new CircleManager(), renderer });
  await controller.add([circle('c')]);
  const tap = north(50 + 3 * MPP);
  assert.equal(controller.find(tap), null, 'no camera yet: the radius only');
  await controller.onCameraChanged(camera);
  assert.equal(controller.find(tap)?.state.id, 'c');
});
