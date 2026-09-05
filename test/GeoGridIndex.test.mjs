import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GeoGridIndex } from '../dist/index.mjs';

/**
 * The grid must answer exactly what a scan would.
 *
 * android-sdk の `MarkerGridIndexTest`、ios-sdk の `MarkerGridIndexTests` と
 * 1 対 1 で対応する。3 つとも同じセルサイズ (0.005°) で、同じ折り返しを行う。
 *
 * ## なぜここを固定するか
 *
 * インデックスの取り違えは**何も落とさない**。マーカーが静かに消えるだけで、
 * 例外も警告も出ない。だからここでは「何か返ってきたか」ではなく、
 * 総当たりの結果と集合として一致するかを毎回比べる。
 */

/** A deterministic spread, so a failure is reproducible. */
function scatter(count, latitude, longitude, spread) {
    let seed = 123456789;
    const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    return Array.from({ length: count }, (_, index) => ({
        id: String(index),
        position: {
            latitude: latitude + (next() - 0.5) * spread,
            longitude: longitude + (next() - 0.5) * spread,
        },
    }));
}

const ids = (items) => new Set(items.map((item) => item.id));

/** Brute force, with the same wrapping the index promises. */
function scan(items, south, north, west, east) {
    const fullGlobe = east - west >= 360;
    const span = fullGlobe ? 360 : (((east - west) % 360) + 360) % 360;
    return items.filter(({ position }) => {
        if (position.latitude < south || position.latitude > north) return false;
        if (fullGlobe) return true;
        return ((((position.longitude - west) % 360) + 360) % 360) <= span;
    });
}

test('a bounds query returns what a scan returns', () => {
    const items = scatter(5000, 35.68, 139.76, 0.6);
    const index = new GeoGridIndex(items);

    // Inside one cell, across several, wider than the data, and over empty
    // ground — the last because an index that returns nothing is right here
    // and wrong everywhere else.
    for (const [south, north, west, east] of [
        [35.6812, 35.6814, 139.7612, 139.7614],
        [35.68, 35.69, 139.76, 139.77],
        [35.0, 36.5, 139.0, 140.5],
        [10.0, 11.0, 100.0, 101.0],
    ]) {
        assert.deepEqual(
            ids(index.queryBounds(south, north, west, east)),
            ids(scan(items, south, north, west, east)),
        );
    }

    assert.ok(index.queryBounds(35.68, 35.69, 139.76, 139.77).length > 0);
    assert.equal(index.queryBounds(35.0, 36.5, 139.0, 140.5).length, items.length);
});

/**
 * 180 度をまたぐ問い合わせ。
 *
 * どちらの呼び出し元もタイルやクリック位置を数ピクセル分ふくらませる。
 * 経度 180 度の近くではその余白が座標範囲の外へはみ出し、`east < west` に
 * なるか ±180 を越えるかのどちらかになる。前者はセルを 1 つも回らずに
 * 静かに空を返し、後者はクリック地点の 2km 隣にあるマーカーを見落とす。
 */
test('a bounds query crosses the antimeridian', () => {
    const items = [
        { id: 'west-of-180', position: { latitude: -18.0, longitude: 179.9 } },
        { id: 'east-of-180', position: { latitude: -18.0, longitude: -179.9 } },
        { id: 'on-180', position: { latitude: -18.0, longitude: 180 } },
        { id: 'far', position: { latitude: -18.0, longitude: 178.0 } },
        { id: 'elsewhere', position: { latitude: -18.0, longitude: 0.0 } },
    ];
    const index = new GeoGridIndex(items);

    // Reversed corners, the shape a padded tile takes there.
    assert.deepEqual(
        ids(index.queryBounds(-18.5, -17.5, 179.5, -179.5)),
        new Set(['west-of-180', 'east-of-180', 'on-180']),
    );

    // Past ±180, the shape a padded click takes there.
    assert.deepEqual(
        ids(index.queryBounds(-18.5, -17.5, 179.8, 180.2)),
        new Set(['west-of-180', 'east-of-180', 'on-180']),
    );
});

test('a query spanning the globe returns everything in its latitudes', () => {
    // Every meridian, so the walk has to fold rather than run off an end.
    const items = Array.from({ length: 181 }, (_, index) => ({
        id: String(index),
        position: { latitude: -80 + (index % 160), longitude: -180 + index * 2 },
    }));
    const index = new GeoGridIndex(items);
    assert.equal(index.queryBounds(-90, 90, -180, 180).length, items.length);
});
