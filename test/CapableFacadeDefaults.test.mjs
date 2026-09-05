import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BaseMapViewController, OVERLAY_KINDS } from '../dist/index.mjs';

/**
 * Capable ファサードの既定実装。
 *
 * android-sdk の `BaseMapViewController` の同名メソッド群と 1 対 1 で対応する。
 * 各プロバイダの `*ViewController` が「登録済みコントローラへ 1 行転送するだけ」で
 * 13 プロバイダ × 約 100 行あったものを、登録済みの SlottedOverlayController から
 * `kind` で解決する既定実装に置き換えた。
 *
 * ## ここで守りたい不変条件
 *
 * 1. **登録し忘れ / kind の書き忘れは「黙って捨てられる」形で出る。**
 *    android で実際に、マーカーコントローラの kind 宣言忘れで全プロバイダの
 *    マーカーが一切表示されない状態を作り込んだ。ビルドも型検査も緑のまますり抜ける。
 * 2. **`hasXxx` は「どれかが持っていれば true」。** クラスタリングが同じ marker 種別で
 *    追加のコントローラを登録するため。
 * 3. **`compositionXxx` は主コントローラ（最初に登録されたもの）だけへ流す。**
 */

class FakeSlot {
    constructor(kind) {
        this.kind = kind;
        this.ids = new Set();
        this.composed = [];
        this.updated = [];
        this.listener = undefined;
    }

    hasId(id) {
        return this.ids.has(id);
    }

    async compositionAny(data) {
        this.composed.push(data);
        data.forEach((state) => this.ids.add(state.id));
    }

    async updateAny(state) {
        this.updated.push(state);
    }

    setClickListenerAny(listener) {
        this.listener = listener;
    }
}

/** カメラ購読だけの拡張モジュール（スロットに参加しない）。 */
class CameraOnly {
    constructor() {
        this.cameras = [];
    }

    onCameraChanged(camera) {
        this.cameras.push(camera);
    }
}

class TestController extends BaseMapViewController {}

function newController(kinds = OVERLAY_KINDS) {
    const controller = new TestController();
    const slots = new Map();
    for (const kind of kinds) {
        const slot = new FakeSlot(kind);
        slots.set(kind, slot);
        controller.registerOverlayController(slot);
    }
    return { controller, slots };
}

test('6 種別すべてが composition / update / has で引ける', async () => {
    const { controller, slots } = newController();

    await controller.compositionMarkers([{ id: 'm' }]);
    await controller.compositionPolylines([{ id: 'l' }]);
    await controller.compositionPolygons([{ id: 'g' }]);
    await controller.compositionCircles([{ id: 'c' }]);
    await controller.compositionGroundImages([{ id: 'i' }]);
    await controller.compositionRasterLayers([{ id: 'r' }]);

    assert.deepEqual(slots.get('marker').composed, [[{ id: 'm' }]]);
    assert.deepEqual(slots.get('polyline').composed, [[{ id: 'l' }]]);
    assert.deepEqual(slots.get('polygon').composed, [[{ id: 'g' }]]);
    assert.deepEqual(slots.get('circle').composed, [[{ id: 'c' }]]);
    assert.deepEqual(slots.get('groundImage').composed, [[{ id: 'i' }]]);
    assert.deepEqual(slots.get('rasterLayer').composed, [[{ id: 'r' }]]);

    assert.equal(controller.hasMarker({ id: 'm' }), true);
    assert.equal(controller.hasPolyline({ id: 'l' }), true);
    assert.equal(controller.hasPolygon({ id: 'g' }), true);
    assert.equal(controller.hasCircle({ id: 'c' }), true);
    assert.equal(controller.hasGroundImage({ id: 'i' }), true);
    assert.equal(controller.hasRasterLayer({ id: 'r' }), true);

    assert.equal(controller.hasMarker({ id: 'nope' }), false);
});

test('update は該当種別の主コントローラへ流れる', async () => {
    const { controller, slots } = newController();
    await controller.updateCircle({ id: 'c' });
    assert.deepEqual(slots.get('circle').updated, [{ id: 'c' }]);
    assert.equal(slots.get('polygon').updated.length, 0);
});

test('登録していない種別は黙って何も起きない（落ちない）', async () => {
    const { controller } = newController(['marker']);
    await controller.compositionCircles([{ id: 'c' }]);
    assert.equal(controller.hasCircle({ id: 'c' }), false);
});

test('kind を書き忘れたコントローラはスロットに参加しない', async () => {
    const controller = new TestController();
    const broken = new FakeSlot('circle');
    delete broken.kind;
    controller.registerOverlayController(broken);

    await controller.compositionCircles([{ id: 'c' }]);

    assert.equal(broken.composed.length, 0, 'kind が無いものへ流してはいけない');
    assert.equal(controller.hasCircle({ id: 'c' }), false);
});

test('composition は主コントローラだけ / has は全部を見る', async () => {
    const controller = new TestController();
    const primary = new FakeSlot('marker');
    const secondary = new FakeSlot('marker');
    controller.registerOverlayController(primary);
    controller.registerOverlayController(secondary);

    await controller.compositionMarkers([{ id: 'a' }]);
    assert.equal(primary.composed.length, 1, '最初に登録したものが主');
    assert.equal(secondary.composed.length, 0, '2 つめへは流さない');

    secondary.ids.add('b');
    assert.equal(controller.hasMarker({ id: 'b' }), true, 'has はどれかが持っていれば true');
});

test('カメラ購読だけの拡張モジュールはスロットに巻き込まれない', async () => {
    const controller = new TestController();
    const extension = new CameraOnly();
    const slot = new FakeSlot('marker');
    controller.registerOverlayController(extension);
    controller.registerOverlayController(slot);

    await controller.compositionMarkers([{ id: 'a' }]);
    assert.equal(slot.composed.length, 1);
});

test('非推奨のクリックリスナー設定は同じ種別の全コントローラへ配る', () => {
    const controller = new TestController();
    const a = new FakeSlot('polygon');
    const b = new FakeSlot('polygon');
    const other = new FakeSlot('circle');
    [a, b, other].forEach((c) => controller.registerOverlayController(c));

    const listener = () => {};
    controller.setOnPolygonClickListener(listener);

    assert.equal(a.listener, listener);
    assert.equal(b.listener, listener);
    assert.equal(other.listener, undefined, '別種別へは配らない');
});

test('OverlayKind は 6 種別', () => {
    assert.equal(OVERLAY_KINDS.length, 6);
    assert.equal(new Set(OVERLAY_KINDS).size, 6);
});
