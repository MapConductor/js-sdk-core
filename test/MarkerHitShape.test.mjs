// タップに反応する範囲は、描かれたピン（とラベル）であって、それを囲む正方形のビットマップではない。
//
// 既定のピンは 48 × 48 のビットマップの中に幅 3 分の 2 ほどで描かれる。以前はビットマップ全体を
// 当たり判定に使っていたので、ピンの左右の透明な部分を押しても反応した。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ColorDefaultIcon,
    MARKER_HIT_RADIUS_MOUSE_PX,
    MARKER_HIT_RADIUS_TOUCH_PX,
    markerHitShape,
    pickMarkerIndex,
} from '../dist/index.mjs';

const near = (actual, expected, tolerance, what) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

test('既定のピンは、描かれた幅だけが当たる（正方形の左右は外れる）', () => {
    const bitmap = new ColorDefaultIcon().toBitmapIcon();
    assert.equal(bitmap.size.width, 48);
    const shape = markerHitShape(bitmap);
    // 実測（MapLibre で描画差分を取った）: 幅 31 px、高さ 45 px。
    near(shape.width, 31, 2, 'width');
    near(shape.height, 45, 2, 'height');
    // ピンの輪郭（設計座標 x 4〜20）は外接箱（幅 23.5）の中心から少しずれて描かれる。
    near(shape.anchor.x, 0.5, 0.02, 'anchor x');
    assert.ok(shape.anchor.y >= 1 && shape.anchor.y < 1.1, `anchor y ${shape.anchor.y}: the tip is at the bottom`);

    // 先端 (100, 100)。ピンの横 12 px（正方形の中だが、ピンの外）はマウスでは当たらない。
    const rect = { anchorScreen: { x: 100, y: 100 }, ...shape };
    assert.equal(pickMarkerIndex({ x: 100, y: 80 }, [rect], MARKER_HIT_RADIUS_MOUSE_PX), 0, 'on the pin');
    assert.equal(pickMarkerIndex({ x: 100 - 20, y: 80 }, [rect], MARKER_HIT_RADIUS_MOUSE_PX), null, 'beside the pin');
    assert.equal(pickMarkerIndex({ x: 100, y: 104 }, [rect], MARKER_HIT_RADIUS_MOUSE_PX), null, 'below the tip');
});

test('指は許容量のぶん外れても当たる', () => {
    const rect = { anchorScreen: { x: 100, y: 100 }, ...markerHitShape(new ColorDefaultIcon().toBitmapIcon()) };
    assert.equal(MARKER_HIT_RADIUS_MOUSE_PX, 0);
    assert.equal(MARKER_HIT_RADIUS_TOUCH_PX, 20);
    assert.equal(pickMarkerIndex({ x: 100 - 20, y: 80 }, [rect], MARKER_HIT_RADIUS_TOUCH_PX), 0);
});

test('横に置いたラベルも当たる', () => {
    const icon = new ColorDefaultIcon({ label: '信州大学', labelPosition: 'right' });
    const bitmap = icon.toBitmapIcon();
    const shape = markerHitShape(bitmap);
    assert.ok(shape.width > 40, `the label widens the target (${shape.width})`);
    const rect = { anchorScreen: { x: 100, y: 100 }, ...shape };
    // 先端から右へ 40 px、頭の高さあたり: ラベルの上。
    assert.equal(pickMarkerIndex({ x: 140, y: 100 - shape.height / 2 }, [rect], 0), 0);
});

test('hitBounds の無いビットマップ（ImageIcon など）は全体が当たる（従来どおり）', () => {
    const bitmap = { url: 'x', anchor: { x: 0.5, y: 0.5 }, size: { width: 32, height: 32 } };
    assert.deepEqual(markerHitShape(bitmap), { width: 32, height: 32, anchor: { x: 0.5, y: 0.5 } });
});

test('描画サイズを渡すと、その大きさで返す（タイル化マーカーは拡大縮小して描く）', () => {
    const bitmap = new ColorDefaultIcon().toBitmapIcon();
    const one = markerHitShape(bitmap);
    const twice = markerHitShape(bitmap, bitmap.size.width * 2, bitmap.size.height * 2);
    near(twice.width, one.width * 2, 0.001, 'width');
    near(twice.height, one.height * 2, 0.001, 'height');
    assert.deepEqual(twice.anchor, one.anchor);
});
