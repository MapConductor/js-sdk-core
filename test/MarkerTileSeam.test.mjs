// 隣り合うタイルは、継ぎ目にかかるマーカーについて同じ判断をしなければならない。
//
// タイルは 1 枚ずつ独立に描かれる。あるマーカーがタイル A では描かれ、隣の B では
// 描かれないと、境界でアイコンが**切れて**見える。A 側の半分だけが残り、続きが
// どこにも無い。
//
// レンダラは、アイコンが食い込む分だけ箱を広げて問い合わせる（`queryCandidates`）。
// だから「A に返ったもののうち B の広げた箱にも入るものは、B にも返る」が成り立て
// ば、継ぎ目は合う。ここが見ているのはその 1 点だけで、描画には触れない。
//
// android-sdk の `MarkerTileSeamTest`、ios-sdk の `MarkerTileSeamTests` と同じ。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GeoGridIndex } from '../dist/index.mjs';

const TILE_SIZE = 512;
const DECLUTTER_PX = 14;
const HALF_EXTENT_PX = 10;

function markers(count) {
    let seed = 123456789;
    const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    return Array.from({ length: count }, (_, index) => ({
        id: String(index),
        position: { latitude: 35.5 + next() * 0.4, longitude: 139.5 + next() * 0.5 },
    }));
}

/** タイル座標から緯度経度の箱。レンダラと同じ式。 */
function tileBounds(x, y, z) {
    const n = 2 ** z;
    const lon = (tx) => (tx / n) * 360 - 180;
    const lat = (ty) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty / n)))) * 180) / Math.PI;
    return { south: lat(y + 1), north: lat(y), west: lon(x), east: lon(x + 1) };
}

/**
 * レンダラが実際に問い合わせる箱と分離距離。
 *
 * 分離距離が最下段より細かいズームでは索引が間引きを断り、レンダラは全件クエリに
 * 落ちる。そちらも継ぎ目が合っていなければならないので、断られたら `queryBounds`
 * の結果で同じことを見る。
 */
function ask(index, x, y, z) {
    const { south, north, west, east } = tileBounds(x, y, z);
    const latSpan = north - south;
    const lonSpan = east - west;
    const padNorm = HALF_EXTENT_PX / TILE_SIZE;
    const box = {
        south: south - latSpan * padNorm,
        north: north + latSpan * padNorm,
        west: west - lonSpan * padNorm,
        east: east + lonSpan * padNorm,
    };
    const separation = (Math.max(latSpan, lonSpan) * DECLUTTER_PX) / TILE_SIZE;
    const thinned = index.queryBoundsThinned(box.south, box.north, box.west, box.east, separation);
    if (thinned !== null) return { box, kept: thinned, thinned: true };
    return { box, kept: index.queryBounds(box.south, box.north, box.west, box.east), thinned: false };
}

const insideBox = (box, item) =>
    item.position.latitude >= box.south &&
    item.position.latitude <= box.north &&
    item.position.longitude >= box.west &&
    item.position.longitude <= box.east;

test('隣り合うタイルは共有するマーカーについて一致する', () => {
    const index = new GeoGridIndex(markers(144183));

    let checked = 0;
    let thinnedPairs = 0;
    for (const z of [9, 10, 11, 12, 13, 14]) {
        const n = 2 ** z;
        const x = Math.floor(((139.75 + 180) / 360) * n);
        const latRad = (35.68 * Math.PI) / 180;
        const y = Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
        );

        // 横隣りと縦隣り。継ぎ目は 2 方向にある。
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const a = ask(index, x, y, z);
            const b = ask(index, x + dx, y + dy, z);
            // 低いズームではマーカーの塊が 1 枚に収まり、隣が空になる。
            if (a.kept.length === 0 || b.kept.length === 0) continue;
            checked++;
            if (a.thinned) thinnedPairs++;

            const inB = new Set(b.kept.map((item) => item.id));
            const missing = a.kept.filter((item) => insideBox(b.box, item) && !inB.has(item.id));
            assert.equal(
                missing.length,
                0,
                `z=${z} d=(${dx},${dy}) thinned=${a.thinned}: A が描く ${missing.length} 個を、` +
                    '重なる B が描かない -- 継ぎ目でアイコンが切れる',
            );
        }
    }
    assert.ok(checked >= 8, '比べられた組が少なすぎる');
    assert.ok(thinnedPairs >= 4, '間引きが効いている組を見ていない');
});
