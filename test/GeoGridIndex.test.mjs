import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GeoGridIndex, MarkerGrid } from '../dist/index.mjs';

/**
 * The grid must answer exactly what a scan would.
 *
 * android-sdk の `MarkerGridIndexTest`、ios-sdk の `MarkerGridIndexTests` と
 * 1 対 1 で対応する。3 つとも同じ階層セル（`MarkerGrid`）を使い、同じ折り返しを行う。
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

/**
 * 間引きクエリは、覆ったセルすべてから 1 つずつ返す。
 *
 * android-sdk の `thinnedQueryKeepsOneMarkerFromEveryCellItCovers`、ios-sdk の
 * `testThinnedQueryKeepsOneMarkerFromEveryCellItCovers` と同じもの。困るのは
 * **穴**で、箱の中に中身を持つセルが何も返さないと、地図上ではマーカーの無い
 * 一角になり、どこにもエラーは出ない。
 *
 * 箱の外のものが混じるのは正しい。セルの代表は箱と無関係に決まるので、縁の
 * セルの代表が箱の外に落ちることがある。そこを縁で切り捨てないことが、隣の
 * タイルと判断を揃える条件そのもの（`MarkerTileSeam.test.mjs`）。
 */
test('間引きクエリは覆ったセルすべてから 1 つずつ返す', () => {
    const items = scatter(60000, 35.68, 139.76, 0.4);
    const index = new GeoGridIndex(items);
    const [south, north, west, east] = [35.6, 35.76, 139.68, 139.84];

    // index が選ぶ段を、こちらでも同じ式で出す。0.005 度に対しては段 16 --
    // 偶数段なので geocell でちょうど 9 文字になり、文字列で名指しできる。
    assert.equal(MarkerGrid.levelForSeparation(0.005), 16);
    const cellOf = (item) => MarkerGrid.geocell(item.position.latitude, item.position.longitude, 9);

    const kept = index.queryBoundsThinned(south, north, west, east, 0.005);
    assert.ok(kept !== null, '0.005 度は最下段より粗いので、必ず答えられるはず');

    const inside = index.queryBounds(south, north, west, east);
    assert.ok(inside.length > 1000, '比較できるだけの中身が要る');

    // 箱の中にいるものが属するセルは、1 つ残らず代表を持っていること。
    const keptCells = new Set(kept.map(cellOf));
    for (const cell of new Set(inside.map(cellOf))) {
        assert.ok(keptCells.has(cell), `セル ${cell} が代表を返していない`);
    }
    assert.equal(keptCells.size, kept.length, '同じセルから 2 つ返っている');
    // はみ出しは縁のセル 1 つぶんまで。
    const insideIds = ids(inside);
    const outside = kept.filter((item) => !insideIds.has(item.id));
    assert.ok(outside.length < kept.length * 0.15, '縁のセル 1 つぶんでは説明のつかない数が外にいる');
    // これが無いと、間引く必要のないほど疎なデータでも上の assert が通ってしまう。
    assert.ok(kept.length * 2 < inside.length, '間引きを働かせるには疎すぎる');
});

/**
 * セルが呼び出し側の分離距離より細かくできないときは、断る。
 *
 * 平らなグリッドだったころ、この下限は 0.005 度だった。階層になった今は
 * 最下段（一辺 0.000687 度）が下限で、そこまでは段を選び直して応じる。
 */
test('分離距離が最下段より細かいと断る', () => {
    const index = new GeoGridIndex(scatter(2000, 35.68, 139.76, 0.4));
    assert.equal(index.queryBoundsThinned(35.6, 35.7, 139.7, 139.8, 0.0005), null);
    assert.ok(index.queryBoundsThinned(35.6, 35.7, 139.7, 139.8, 0.001) !== null);
});

/** 通常クエリが覚えた日付変更線の折り返しは、間引きでも成り立つ必要がある。 */
test('間引きクエリも日付変更線をまたぐ', () => {
    const items = [
        { id: 'a', position: { latitude: -18, longitude: 179.99 } },
        { id: 'b', position: { latitude: -18, longitude: -179.99 } },
        { id: 'c', position: { latitude: -18, longitude: 178 } },
    ];
    const kept = new GeoGridIndex(items).queryBoundsThinned(-18.5, -17.5, 179.5, -179.5, 0.01);
    assert.ok(kept !== null);
    assert.deepEqual(new Set(kept.map((i) => i.id)), new Set(['a', 'b']));
});

/**
 * どんな形の箱でも、索引は走査と同じ答えを返す必要がある。
 *
 * 四角い箱だけでは、新しい段選びの**軸ごとの上限**が効く経路---極端に平たい帯、
 * 極端に細い縦帯---を一度も通らない。そこを外しても地図には何も起きず、その形の
 * 問い合わせだけが静かにマーカーを落とす。
 *
 * ほぼ全球の箱を入れてあるのは、経度の列が折り返すため。180 の列と -180 の列は
 * 同じなので、東端の列から歩く終わりを決めると 1 列しか見ない（`columnWalk`）。
 *
 * android-sdk の `boundsQueryMatchesBruteForceForEveryShapeOfBox`、
 * ios-sdk の同名テストと対になる。
 */
test('どんな形の箱でも走査と一致する', () => {
    // 2 つ目の群の id をずらす。`scatter` は毎回 0 から振るので、そのまま足すと
    // id が重なり、集合比較が別のマーカーを 1 つに畳んでしまう。
    const near = scatter(30000, 35.68, 139.76, 0.8);
    const far = scatter(10000, -18, 179.95, 0.6).map((item) => ({
        ...item,
        id: String(Number(item.id) + 30000),
    }));
    const items = [...near, ...far];
    const index = new GeoGridIndex(items);

    const boxes = [
        // タイル相当（z=14 から z=9 まで）。
        [35.68, 35.6946, 139.76, 139.782],
        [35.6, 35.7, 139.6, 139.8],
        [35.2, 36.2, 139.2, 140.2],
        // 極端に平たい帯と、極端に細い縦帯。
        [35.679, 35.681, 139.0, 140.5],
        [35.0, 36.4, 139.759, 139.761],
        // ほぼ全球と、日付変更線をまたぐ箱。
        [-85, 85, -179.9, 179.9],
        [-18.5, -17.5, 179.5, -179.5],
        // 何も無い場所。
        [10, 11, 100, 101],
    ];
    let nonEmpty = 0;
    boxes.forEach(([south, north, west, east], at) => {
        const expected = scan(items, south, north, west, east);
        const found = index.queryBounds(south, north, west, east);
        assert.deepEqual(ids(found), ids(expected), `箱 ${at}: 走査と食い違った`);
        assert.equal(found.length, expected.length, `箱 ${at}: 同じマーカーを 2 度返した`);
        if (expected.length > 0) nonEmpty++;
    });
    assert.equal(nonEmpty, 7, '空の集合どうしを比べているだけになっている');
});
