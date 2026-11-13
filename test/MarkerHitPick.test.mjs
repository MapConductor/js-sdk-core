// タップ点に当たるマーカーの選び方。android-sdk の `MarkerHitTestPickTest`、
// ios-sdk の `MarkerHitTestPickTests` と同じ観点を見る。
//
// 指の下にアイコン（ラベル込み）が描かれているマーカーは、近くに別のマーカーの先端が
// あっても勝つ。どの矩形にも入らないときだけ、許容範囲内でアンカーの近いものを選ぶ。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGeoPoint, markerSearchBounds, pickMarkerIndex, preferMarkerHit } from '../dist/index.mjs';

const rect = (x, y, { width = 48, height = 48, anchorX = 0.5 } = {}) => ({
    anchorScreen: { x, y },
    width,
    height,
    anchor: { x: anchorX, y: 1 },
});

test('指の下のラベルは、先端の近い別のマーカーより勝つ', () => {
    // labelled: 先端 (0, 100)、ラベルを右へ伸ばして幅 200（矩形 x -24..176, y 52..100）。
    // nearTip:  先端 (150, 70) でタップ点にずっと近いが、矩形 (126..174, 22..70) はタップ点に届かない。
    const labelled = rect(0, 100, { width: 200, anchorX: 0.12 });
    const nearTip = rect(150, 70);
    assert.equal(pickMarkerIndex({ x: 150, y: 80 }, [nearTip, labelled], 14), 1);
});

test('アイコンが重なっていたら手前（画面下）のもの', () => {
    assert.equal(pickMarkerIndex({ x: 100, y: 90 }, [rect(100, 100), rect(100, 120)], 14), 1);
});

test('どの矩形にも入らないときだけ、許容範囲内でアンカーの近いもの', () => {
    const rects = [rect(100, 100), rect(140, 100)];
    assert.equal(pickMarkerIndex({ x: 170, y: 105 }, rects, 40), 1);
    assert.equal(pickMarkerIndex({ x: 400, y: 400 }, rects, 14), null);
});

test('別々に探した結果も同じ規則でまとめる（真下 > 近接、近接同士は距離）', () => {
    const exact = { item: 'tiled', exact: true, anchorY: 10, distance: 50 };
    const near = { item: 'regular', exact: false, anchorY: 90, distance: 2 };
    assert.equal(preferMarkerHit(near, exact).item, 'tiled');
    assert.equal(preferMarkerHit(near, { ...near, item: 'closer', distance: 1 }).item, 'closer');
    assert.equal(preferMarkerHit(null, near).item, 'regular');
});

test('画素に丸める投影（ArcGIS の 3D SceneView）でも探索範囲を作れる。引いた縮尺で 1e-4° は 1 px 未満', () => {
  const worldPx = 512 * 2 ** 9; // zoom 9: 728 px a degree
  const project = (p) => {
    const x = ((p.longitude + 180) / 360) * worldPx;
    const s = Math.sin((p.latitude * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx;
    return { x: Math.round(x), y: Math.round(y) };
  };
  const tap = createGeoPoint({ latitude: 21.31, longitude: -157.86 });
  const bounds = markerSearchBounds(tap, project(tap), project, 512);
  assert.ok(bounds, 'bounds were not made');
  const halfLon = (bounds.northEast.longitude - bounds.southWest.longitude) / 2;
  assert.ok(halfLon > 0.63 && halfLon < 0.77, `half width ${halfLon}`); // 512 px is about 0.70°
});
