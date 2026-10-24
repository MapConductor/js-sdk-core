import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildVisibleRegion, createGeoPoint } from '../dist/index.mjs';

/**
 * ビューポートの 4 隅の逆投影と bounds の組み立て。
 *
 * android-sdk の `VisibleRegionBuilderTest`、ios-sdk の
 * `VisibleRegionBuilderTests` と 1 対 1 で対応する。
 *
 * ## なぜここを固定するか
 *
 * 移行前は 7 プロバイダが同じ 18 行を各自持っていた。**隅の割り当てを取り違えても
 * 何も落ちない**（4 点とも埋まっているので bounds は正しく見える）。実際 ios-for-mapbox
 * では nearLeft←se / farLeft←ne のように入れ替わっていて、マーカークラスタリングの
 * ビューポート判定だけが静かにずれていた。
 */

/** 画面座標 (x, y) を (lat, lng) = (-y, x) に写す。上が北になるので隅の対応が読みやすい。 */
function linearHolder(unresolvable = []) {
    const blocked = new Set(unresolvable.map(({ x, y }) => `${x},${y}`));
    return {
        fromScreenOffsetSync({ x, y }) {
            if (blocked.has(`${x},${y}`)) return null;
            // + 0 は -0 を 0 に潰すため（assert.deepEqual は -0 と 0 を区別する）。
            return createGeoPoint({ latitude: -y + 0, longitude: x });
        },
    };
}

test('corners are assigned correctly', () => {
    const region = buildVisibleRegion(linearHolder(), { width: 100, height: 50 });

    // nearLeft/nearRight は画面の下端、farLeft/farRight は上端。
    assert.deepEqual([region.nearLeft.longitude, region.nearLeft.latitude], [0, -50]);
    assert.deepEqual([region.nearRight.longitude, region.nearRight.latitude], [100, -50]);
    assert.deepEqual([region.farLeft.longitude, region.farLeft.latitude], [0, 0]);
    assert.deepEqual([region.farRight.longitude, region.farRight.latitude], [100, 0]);
});

test('bounds contain every corner', () => {
    const region = buildVisibleRegion(linearHolder(), { width: 100, height: 50 });
    for (const corner of [region.nearLeft, region.nearRight, region.farLeft, region.farRight]) {
        assert.ok(region.bounds.contains(corner), `bounds が隅を含んでいない: ${JSON.stringify(corner)}`);
    }
});

test('inset uses inner points', () => {
    const region = buildVisibleRegion(linearHolder(), { width: 100, height: 50 }, { inset: 10 });
    assert.deepEqual([region.farLeft.longitude, region.farLeft.latitude], [10, -10]);
    assert.deepEqual([region.nearRight.longitude, region.nearRight.latitude], [90, -40]);
});

test('requireAllCorners rejects a partial region', () => {
    const holder = linearHolder([{ x: 0, y: 0 }]); // farLeft が解けない
    assert.equal(buildVisibleRegion(holder, { width: 100, height: 50 }), null);
});

test('without requireAllCorners it keeps what resolved', () => {
    const holder = linearHolder([{ x: 0, y: 0 }]);
    const region = buildVisibleRegion(holder, { width: 100, height: 50 }, { requireAllCorners: false });
    assert.equal(region.farLeft, null);
    assert.ok(region.nearLeft);
    assert.ok(region.bounds.contains(region.nearRight));
});

test('no resolvable corner gives null', () => {
    const holder = {
        fromScreenOffsetSync: () => null,
    };
    assert.equal(buildVisibleRegion(holder, { width: 100, height: 50 }, { requireAllCorners: false }), null);
});

test('an unmeasured viewport gives null', () => {
    assert.equal(buildVisibleRegion(linearHolder(), { width: 0, height: 0 }), null);
});
