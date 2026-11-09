import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGeoPoint, createPolygonState, PolygonManager } from '../dist/index.mjs';

/**
 * A tap counts as on a polygon's edge only when it is within `eps` (1e-6°,
 * about 0.1 m) of that edge. Taps outside the polygon's bounding box never get
 * that far, so the tolerance only matters on and just inside the outline.
 *
 * android-sdk の `PolygonHitToleranceTest`、ios-sdk の `PolygonHitToleranceTests` と
 * 1 対 1 で対応する。
 *
 * ## なぜここを固定するか
 *
 * 辺上の判定が度の 2 乗の量（内積）を 1e-6 と比べていて、短い辺から約 100 m 以内の
 * タップをすべて「辺上」として拾っていた。建物の輪郭のように辺が数 m のポリゴンを
 * 並べると、タップした建物ではなく、リストで先にある近所の建物が返る。大きな図形では
 * 起きないので、サンプルの六角形では見えなかった。
 */

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });

// ボストン中心部の、一辺が約 10 m の建物
const building = [p(42.3550, -71.0600), p(42.3550, -71.0599), p(42.3551, -71.0599), p(42.3551, -71.0600), p(42.3550, -71.0600)];

function managerWith(...states) {
  const manager = new PolygonManager();
  for (const state of states) manager.registerEntity({ state, polygon: null });
  return manager;
}

test('50 m 離れたタップは、辺の短い建物に当たらない', () => {
  const manager = managerWith(createPolygonState({ id: 'small', points: building }));
  // 建物の東の辺から東へ約 50 m（経度 0.0006°）
  assert.equal(manager.find(p(42.35505, -71.0593)), null);
  // 北へ約 50 m
  assert.equal(manager.find(p(42.3556, -71.05995)), null);
});

test('内側のタップと辺の上のタップは当たり、0.6 m 外れたタップは当たらない', () => {
  const manager = managerWith(createPolygonState({ id: 'small', points: building }));
  assert.equal(manager.find(p(42.35505, -71.05995))?.state.id, 'small');
  assert.equal(manager.find(p(42.3550, -71.05995))?.state.id, 'small', '南の辺の上');
  assert.equal(manager.find(p(42.354995, -71.05995)), null, '南の辺から外へ約 0.6 m');
});

test('近所の建物ではなく、タップした建物が返る', () => {
  // 西隣（約 20 m 西）にもう 1 棟。リストでは先に入れる
  const west = building.map(q => p(q.latitude, q.longitude - 0.00025));
  const manager = managerWith(
    createPolygonState({ id: 'west', points: west }),
    createPolygonState({ id: 'tapped', points: building }),
  );
  assert.equal(manager.find(p(42.35505, -71.05995))?.state.id, 'tapped');
});
