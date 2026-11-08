import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildPolygonRings,
    buildUnwrappedPolygonRings,
    buildUnwrappedPolylinePath,
    createGeoPoint,
    createPolygonState,
    densifyPolygonRing,
    Planar,
    PolygonManager,
    WGS84Geodesic,
} from '../dist/index.mjs';

/**
 * ポリゴンの閉じる辺（末尾 → 先頭）も他の辺と同じ方式で補間すること。geodesic は大圏、
 * geodesic=false は緯度経度の線形補間。どちらも塗り・穴・輪郭が同じ点列になる。
 *
 * android-sdk の `GeodesicPolygonRingTest`、ios-sdk の `GeodesicPolygonRingTests` と 1 対 1 で対応する。
 *
 * ## 何が起きていたか
 *
 * `WGS84Geodesic.createInterpolatePoints` は隣り合う点の間しか補間しない。ポリゴンの点は
 * 開いたリング（末尾 ≠ 先頭）で渡されるので、塗りのリングは閉じる辺だけが補間されず、
 * 描画側で閉じたときに直線の弦になっていた。一方、輪郭はリングを閉じてからポリラインとして
 * 密度化するので大圏になる。結果「輪郭は曲線、塗りの一辺だけ直線」になる。
 * Google のように塗りと輪郭を 1 つのネイティブポリゴンで描くプロバイダは、輪郭まで直線になる。
 */

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const BOSTON = p(42.36, -71.06);
const LONDON = p(51.5, -0.12);
const ICELAND = p(64.1, -21.9);
// 実機検証と同じ順序。閉じる辺は アイスランド → ボストン。
const TRIANGLE = [BOSTON, LONDON, ICELAND];

const same = (a, b) => Math.abs(a.latitude - b.latitude) < 1e-9 && Math.abs(a.longitude - b.longitude) < 1e-9;

function assertSamePoints(actual, expected) {
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(same(actual[i], expected[i]), `point ${i}: ${JSON.stringify(actual[i])} != ${JSON.stringify(expected[i])}`);
    }
}

/** 輪郭（閉じたリングをポリラインとして密度化）から、末尾の重複点を除いたもの。 */
function outlineOf(points, geodesic) {
    const path = buildUnwrappedPolylinePath([...points, points[0]], geodesic);
    return path.slice(0, -1);
}

test('大圏の中間点: ボストン → アイスランドは北西へ約 4° 膨らむ', () => {
    const mid = WGS84Geodesic.interpolate({ from: BOSTON, to: ICELAND, fraction: 0.5 });
    // Web メルカトルでの直線（弦）が同じ経度で通る緯度。
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const t = (mid.longitude - BOSTON.longitude) / (ICELAND.longitude - BOSTON.longitude);
    const y = merc(BOSTON.latitude) + t * (merc(ICELAND.latitude) - merc(BOSTON.latitude));
    const chordLat = ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
    assert.ok(Math.abs(mid.latitude - 55.63) < 0.05, `mid ${mid.latitude}`);
    assert.ok(Math.abs(chordLat - 51.6) < 0.05, `chord ${chordLat}`);
});

test('densifyPolygonRing は閉じる辺も補間し、開いたリングのまま返す', () => {
    const ring = densifyPolygonRing(TRIANGLE, true);
    assert.ok(same(ring[0], BOSTON));
    // 先頭の重複点を末尾に付けない（閉じて補間した結果から末尾の 1 点だけを除いた長さ）。
    // createInterpolatePoints は分割比を足し込むため、末尾の手前に終点とほぼ同じ点が残ることがある
    // （ポリラインでも同じ。描画には影響しない）。
    assert.equal(ring.length, WGS84Geodesic.createInterpolatePoints([...TRIANGLE, BOSTON]).length - 1);
    assert.notEqual(ring[ring.length - 1], BOSTON);
    // 閉じる辺の中間点（大圏）が含まれる。
    const expected = WGS84Geodesic.createInterpolatePoints([ICELAND, BOSTON]);
    const tail = ring.slice(ring.length - (expected.length - 2));
    assertSamePoints(tail, expected.slice(1, -1));
});

test('densifyPolygonRing は閉じたリングを閉じたまま返す（二重に閉じない）', () => {
    const closed = [...TRIANGLE, BOSTON];
    assertSamePoints(densifyPolygonRing(closed, true), WGS84Geodesic.createInterpolatePoints(closed));
    assertSamePoints(densifyPolygonRing(closed, false), Planar.createInterpolatePoints(closed));
});

test('densifyPolygonRing は geodesic=false でも閉じる辺を線形補間する', () => {
    const ring = densifyPolygonRing(TRIANGLE, false);
    assert.ok(same(ring[0], BOSTON));
    assert.equal(ring.length, Planar.createInterpolatePoints([...TRIANGLE, BOSTON]).length - 1);
    const expected = Planar.createInterpolatePoints([ICELAND, BOSTON]);
    const tail = ring.slice(ring.length - (expected.length - 2));
    assertSamePoints(tail, expected.slice(1, -1));
});

test('geodesic の塗り（unwrap 版）は輪郭と同じ点列になる', () => {
    const fill = buildUnwrappedPolygonRings(TRIANGLE, [], true).outerRings[0];
    assertSamePoints(fill, outlineOf(TRIANGLE, true));
    // 閉じる辺の中間点（北西へ膨らんだ点）を通る。
    const mid = WGS84Geodesic.interpolate({ from: ICELAND, to: BOSTON, fraction: 0.5 });
    const nearest = Math.min(...fill.map((q) => Math.hypot(q.latitude - mid.latitude, q.longitude - mid.longitude)));
    assert.ok(nearest < 0.1, `nearest ${nearest}`);
});

test('geodesic の塗り（分割版）も閉じる辺を補間する', () => {
    const rings = buildPolygonRings(TRIANGLE, [], true).outerRings;
    assert.equal(rings.length, 1);
    assertSamePoints(rings[0], outlineOf(TRIANGLE, true));
});

// geodesic=false の輪郭は閉じる辺も緯度経度で線形補間する（メルカトルではわずかに曲がる）。
// 塗りも同じ点列であること。以前は閉じる辺だけ補間されず、メルカトル上の直線（弦）だった。
test('geodesic=false の塗りも閉じる辺を含めて輪郭と同じ点列になる', () => {
    const fill = buildUnwrappedPolygonRings(TRIANGLE, [], false).outerRings[0];
    assertSamePoints(fill, outlineOf(TRIANGLE, false));
    const split = buildPolygonRings(TRIANGLE, [], false).outerRings[0];
    assertSamePoints(split, outlineOf(TRIANGLE, false));
    // 閉じる辺（アイスランド → ボストン）の緯度経度の中点が点列に含まれる（弦の上ではない）。
    const mid = p((ICELAND.latitude + BOSTON.latitude) / 2, (ICELAND.longitude + BOSTON.longitude) / 2);
    const nearest = Math.min(...fill.map((q) => Math.hypot(q.latitude - mid.latitude, q.longitude - mid.longitude)));
    assert.ok(nearest < 0.1, `nearest ${nearest}`);
});

test('穴も閉じる辺を補間する', () => {
    const outer = [p(30, -80), p(30, 10), p(70, 10), p(70, -80)];
    const hole = TRIANGLE;
    const unwrapped = buildUnwrappedPolygonRings(outer, [hole], true);
    assertSamePoints(unwrapped.holeRings[0], outlineOf(hole, true));
    assertSamePoints(unwrapped.outerRings[0], outlineOf(outer, true));
    const split = buildPolygonRings(outer, [hole], true);
    assertSamePoints(split.holeRings[0], outlineOf(hole, true));
});

test('geodesic=false の穴も閉じる辺を補間する', () => {
    const outer = [p(30, -80), p(30, 10), p(70, 10), p(70, -80)];
    const hole = TRIANGLE;
    const unwrapped = buildUnwrappedPolygonRings(outer, [hole], false);
    assertSamePoints(unwrapped.holeRings[0], outlineOf(hole, false));
    assertSamePoints(unwrapped.outerRings[0], outlineOf(outer, false));
    assertSamePoints(buildPolygonRings(outer, [hole], false).holeRings[0], outlineOf(hole, false));
});

test('タップ判定も閉じる辺の大圏に従う', () => {
    // 弦と大圏の間（北西へ膨らんだ部分）の点。
    const mid = WGS84Geodesic.interpolate({ from: ICELAND, to: BOSTON, fraction: 0.5 });
    const t = (mid.longitude - ICELAND.longitude) / (BOSTON.longitude - ICELAND.longitude);
    const chordLat = ICELAND.latitude + t * (BOSTON.latitude - ICELAND.latitude);
    const bulge = p((mid.latitude + chordLat) / 2, mid.longitude);

    const manager = new PolygonManager();
    const geodesic = createPolygonState({ id: 'g', points: TRIANGLE, geodesic: true });
    manager.registerEntity({ state: geodesic });
    assert.equal(manager.find(bulge)?.state.id, 'g');

    geodesic.geodesic = false;
    assert.equal(manager.find(bulge), null);
});

// geodesic=false のタップ判定は生の頂点を緯度経度平面で判定する。閉じる辺は緯度経度の直線
// （= 線形補間した塗り・輪郭と同じ線）になり、メルカトルの弦ではない。
test('geodesic=false のタップ判定は閉じる辺の線形補間に従う', () => {
    const midLng = (ICELAND.longitude + BOSTON.longitude) / 2;
    const linearLat = (ICELAND.latitude + BOSTON.latitude) / 2;
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const chordLat = ((2 * Math.atan(Math.exp((merc(ICELAND.latitude) + merc(BOSTON.latitude)) / 2)) - Math.PI / 2) * 180) / Math.PI;
    // メルカトルの弦は緯度経度の直線より北を通る。その間は塗りの外。
    assert.ok(chordLat > linearLat + 0.5, `chord ${chordLat} linear ${linearLat}`);
    const between = p((chordLat + linearLat) / 2, midLng);
    const inside = p(linearLat - 0.5, midLng);

    const manager = new PolygonManager();
    manager.registerEntity({ state: createPolygonState({ id: 'p', points: TRIANGLE, geodesic: false }) });
    assert.equal(manager.find(between), null);
    assert.equal(manager.find(inside)?.state.id, 'p');
});
