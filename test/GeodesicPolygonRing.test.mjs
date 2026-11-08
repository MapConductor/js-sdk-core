import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildPolygonRings,
    buildUnwrappedPolygonRings,
    buildUnwrappedPolylinePath,
    createGeoPoint,
    createPolygonState,
    densifyAndNormalize,
    densifyGeodesicRing,
    PolygonManager,
    WGS84Geodesic,
} from '../dist/index.mjs';

/**
 * geodesic ポリゴンの閉じる辺（末尾 → 先頭）も大圏で補間すること。
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

test('densifyGeodesicRing は閉じる辺も補間し、開いたリングのまま返す', () => {
    const ring = densifyGeodesicRing(TRIANGLE);
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

test('densifyGeodesicRing は閉じたリングを閉じたまま返す（二重に閉じない）', () => {
    const closed = [...TRIANGLE, BOSTON];
    assertSamePoints(densifyGeodesicRing(closed), WGS84Geodesic.createInterpolatePoints(closed));
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

test('geodesic=false は変わらない（閉じる辺を補間しない）', () => {
    const fill = buildUnwrappedPolygonRings(TRIANGLE, [], false).outerRings[0];
    assertSamePoints(fill, densifyAndNormalize(TRIANGLE, false));
    assert.ok(same(fill[fill.length - 1], ICELAND));
    const split = buildPolygonRings(TRIANGLE, [], false).outerRings[0];
    assertSamePoints(split, densifyAndNormalize(TRIANGLE, false));
});

test('穴も閉じる辺を補間する', () => {
    const outer = [p(30, -80), p(30, 10), p(70, 10), p(70, -80)];
    const hole = TRIANGLE;
    const unwrapped = buildUnwrappedPolygonRings(outer, [hole], true);
    assertSamePoints(unwrapped.holeRings[0], outlineOf(hole, true));
    assertSamePoints(unwrapped.outerRings[0], outlineOf(outer, true));
    const split = buildPolygonRings(outer, [hole], true);
    assertSamePoints(split.holeRings[0], outlineOf(hole, true));
    // false の穴は従来どおり。
    assertSamePoints(buildUnwrappedPolygonRings(outer, [hole], false).holeRings[0], densifyAndNormalize(hole, false));
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
