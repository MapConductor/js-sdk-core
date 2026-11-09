import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createGeoPoint,
  decodePolyline,
  encodePolyline,
  PolygonTilingOptions,
  unionHoleRings,
} from '../dist/index.mjs';

/**
 * ポリゴンのタイル描画を支える部品。
 *
 * - Encoded Polyline: Google の仕様どおりの文字列になり、精度 6 でも往復で崩れない。
 *   タイル用サービスワーカー（tile-sw.js の decodePolyline6）が同じ文字列を読む。
 * - しきい値: ポリゴン数か頂点数のどちらかが届けばタイル。判定はここ 1 か所。
 * - 穴のユニオンの近道: 交わらない穴はそのまま返す。道路網の区画（穴 80 個・穴の頂点
 *   8,000）で 1 個数秒かかっていた二乗の計算を、交わる穴があるときだけに絞る。
 */

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });

test('Google の仕様書の例と同じ文字列になり、元に戻る', () => {
  const points = [38.5, -120.2, 40.7, -120.95, 43.252, -126.453];
  const encoded = encodePolyline(points, 5);
  assert.equal(encoded, '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(decodePolyline(encoded, 5), points);
});

test('精度 6 で 1e-6 度まで往復し、経度 ±180 付近でも崩れない', () => {
  const points = [42.355456, -71.060512, 42.355457, -71.060511, -33.868820, 151.209296, 0, 179.999999, 0, -179.999999];
  const decoded = decodePolyline(encodePolyline(points, 6), 6);
  decoded.forEach((v, i) => assert.ok(Math.abs(v - points[i]) < 5e-7, `${i}: ${v} vs ${points[i]}`));
});

test('ポリゴン数か頂点数のどちらかが届けばタイルにする', () => {
  const o = PolygonTilingOptions.Default;
  assert.equal(PolygonTilingOptions.shouldUseTiles(o, 1999, 49_999), false);
  assert.equal(PolygonTilingOptions.shouldUseTiles(o, 2000, 0), true);
  assert.equal(PolygonTilingOptions.shouldUseTiles(o, 10, 50_000), true);
  assert.equal(PolygonTilingOptions.shouldUseTiles(PolygonTilingOptions.Disabled, 100_000, 1e7), false);
});

function square(lat, lng, size) {
  return [p(lat, lng), p(lat, lng + size), p(lat + size, lng + size), p(lat + size, lng)];
}

test('交わらない穴は計算せずに返す（巻きだけ時計回りにそろえる）', () => {
  // square() は反時計回り。結合の結果と同じく時計回りにして返す。
  const holes = [square(0, 0, 1), square(0, 2, 1), square(2, 0, 1)];
  assert.deepEqual(unionHoleRings(holes), holes.map((h) => [...h].reverse()));
  // もとから時計回りなら、渡したものをそのまま返す。
  const clockwise = holes.map((h) => [...h].reverse());
  assert.equal(unionHoleRings(clockwise), clockwise);
});

test('重なる穴・中に入った穴・接する穴は従来どおり 1 つにまとめる', () => {
  assert.equal(unionHoleRings([square(0, 0, 2), square(1, 1, 2)]).length, 1, '重なる');
  assert.equal(unionHoleRings([square(0, 0, 4), square(1, 1, 1)]).length, 1, '中に入った');
  assert.equal(unionHoleRings([square(0, 0, 1), square(0, 1, 1)]).length, 1, '辺で接する');
});

test('交わらない穴が多くても速い（穴 80 個 x 100 頂点）', () => {
  const holes = [];
  for (let i = 0; i < 80; i++) {
    const cx = (i % 10) * 3, cy = Math.floor(i / 10) * 3;
    holes.push(Array.from({ length: 100 }, (_, k) => {
      const a = (2 * Math.PI * k) / 100;
      return p(cy - Math.sin(a), cx + Math.cos(a)); // 時計回り
    }));
  }
  const start = performance.now();
  const result = unionHoleRings(holes);
  const ms = performance.now() - start;
  assert.equal(result, holes);
  assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
});
