import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createMapServiceKey,
    EmptyMapServiceRegistry,
    MAP_CAPABILITIES,
    mapCapabilityFromId,
    MapCapabilityStatus,
    MapServiceRegistrations,
    MutableMapServiceRegistry,
} from '../dist/index.mjs';

/**
 * capability 宣言の意味論テスト。
 *
 * android-sdk の `MapCapabilityDeclarationTest`、ios-sdk の
 * `MapCapabilityDeclarationTests` と 1 対 1 で対応する。
 * 守りたい不変条件は 2 つ:
 *  - **「未宣言」と「非対応」を混同しない。** 初期化途中のマップと、その SDK では
 *    原理的にできないことを、呼び出し側が区別できること。
 *  - **登録トークンで自分の登録だけを外せる。** キー名を列挙した撤収コードを
 *    書かなくて済むこと。
 */

const PlainKey = createMapServiceKey();
const DragKey = createMapServiceKey('markerDrag');

// ── 未宣言 vs 非対応 ────────────────────────────────────────────────────

test('宣言が無ければ unknown であって unsupported ではない', () => {
    const registry = new MutableMapServiceRegistry();
    const status = registry.capabilityStatus('groundImage');

    assert.equal(status.kind, 'unknown');
    assert.equal(status.reason, undefined);
});

test('declareUnsupported は理由つきで非対応を宣言する', () => {
    const registry = new MutableMapServiceRegistry();
    registry.declareUnsupported('screenProjectionSync', 'Longdo JS bridge has no synchronous unproject');

    const status = registry.capabilityStatus('screenProjectionSync');
    assert.equal(status.kind, 'unsupported');
    assert.equal(status.reason, 'Longdo JS bridge has no synchronous unproject');
});

test('degraded と approximated は使えるが完全ではない', () => {
    const registry = new MutableMapServiceRegistry();
    registry.declare('polygonHoles', MapCapabilityStatus.degraded('fill becomes a union'));
    registry.declare('circle', MapCapabilityStatus.approximated('drawn as a polygon'));

    assert.equal(registry.capabilityStatus('polygonHoles').kind, 'degraded');
    assert.equal(registry.capabilityStatus('circle').kind, 'approximated');
});

// ── put による自動宣言 ──────────────────────────────────────────────────

test('capability を持つキーを put すると supported になる', () => {
    const registry = new MutableMapServiceRegistry();
    assert.equal(registry.capabilityStatus('markerDrag').kind, 'unknown');

    registry.put(DragKey, 'impl');

    assert.equal(registry.capabilityStatus('markerDrag').kind, 'supported');
});

test('capability を持たないキーは何も宣言しない', () => {
    const registry = new MutableMapServiceRegistry();
    registry.put(PlainKey, 'impl');

    assert.equal(registry.has(PlainKey), true);
    assert.equal(registry.declaredCapabilities().size, 0);
});

test('has は登録の有無を返す', () => {
    const registry = new MutableMapServiceRegistry();
    assert.equal(registry.has(PlainKey), false);
    registry.put(PlainKey, 'impl');
    assert.equal(registry.has(PlainKey), true);
});

// ── 登録トークン ────────────────────────────────────────────────────────

test('dispose は自分の登録だけを外す', () => {
    const registry = new MutableMapServiceRegistry();
    const plain = registry.register(PlainKey, 'plain');
    registry.put(DragKey, 'drag');

    plain.dispose();

    assert.equal(registry.get(PlainKey), null);
    assert.equal(registry.get(DragKey), 'drag');
    assert.equal(registry.capabilityStatus('markerDrag').kind, 'supported');
});

test('dispose は capability の宣言も戻す', () => {
    const registry = new MutableMapServiceRegistry();
    const registration = registry.register(DragKey, 'drag');
    assert.equal(registry.capabilityStatus('markerDrag').kind, 'supported');

    registration.dispose();

    assert.equal(registry.capabilityStatus('markerDrag').kind, 'unknown');
});

test('上書きされた後の dispose は新しい値を消さない', () => {
    const registry = new MutableMapServiceRegistry();
    const first = registry.register(PlainKey, 'first');
    registry.put(PlainKey, 'second');

    first.dispose();

    assert.equal(registry.get(PlainKey), 'second', '上書き後の値まで消してはいけない');
});

test('declare の dispose は直前の宣言へ戻す', () => {
    const registry = new MutableMapServiceRegistry();
    registry.declare('cameraTilt', MapCapabilityStatus.supported);
    const second = registry.declare('cameraTilt', MapCapabilityStatus.degraded('emulated'));

    second.dispose();

    assert.equal(registry.capabilityStatus('cameraTilt').kind, 'supported');
});

test('MapServiceRegistrations は登録をまとめて外す', () => {
    const registry = new MutableMapServiceRegistry();
    const registrations = new MapServiceRegistrations();
    registrations.add(registry.register(PlainKey, 'plain'));
    registrations.add(registry.register(DragKey, 'drag'));
    registrations.add(registry.declareUnsupported('groundImage', 'no API'));

    registrations.disposeAll();

    assert.equal(registry.get(PlainKey), null);
    assert.equal(registry.get(DragKey), null);
    assert.equal(registry.capabilityStatus('markerDrag').kind, 'unknown');
    assert.equal(registry.capabilityStatus('groundImage').kind, 'unknown');
});

test('disposeAll の二重呼び出しは安全', () => {
    const registry = new MutableMapServiceRegistry();
    const registrations = new MapServiceRegistrations();
    registrations.add(registry.register(PlainKey, 'plain'));

    registrations.disposeAll();
    registrations.disposeAll();

    assert.equal(registry.get(PlainKey), null);
});

// ── 既存 API との共存 ───────────────────────────────────────────────────

test('remove は capability の宣言も取り下げる', () => {
    const registry = new MutableMapServiceRegistry();
    registry.put(DragKey, 'drag');

    registry.remove(DragKey);

    assert.equal(registry.get(DragKey), null);
    assert.equal(registry.capabilityStatus('markerDrag').kind, 'unknown');
});

test('clear は宣言も消す', () => {
    const registry = new MutableMapServiceRegistry();
    registry.put(DragKey, 'drag');
    registry.declareUnsupported('groundImage', 'no API');

    registry.clear();

    assert.equal(registry.capabilityStatus('markerDrag').kind, 'unknown');
    assert.equal(registry.capabilityStatus('groundImage').kind, 'unknown');
});

test('EmptyMapServiceRegistry は常に unknown', () => {
    assert.equal(EmptyMapServiceRegistry.capabilityStatus('marker').kind, 'unknown');
    assert.equal(EmptyMapServiceRegistry.has(PlainKey), false);
    assert.equal(EmptyMapServiceRegistry.get(PlainKey), null);
});

test('MapCapability の id は一意で fromId が引ける', () => {
    assert.equal(MAP_CAPABILITIES.length, new Set(MAP_CAPABILITIES).size, 'id が重複している');
    for (const capability of MAP_CAPABILITIES) {
        assert.equal(mapCapabilityFromId(capability), capability);
    }
    assert.equal(mapCapabilityFromId('nope'), null);
});

// ── 素の registry の振る舞い（android の MapServiceRegistryTest 相当） ───

test('put した値が get で取れる / 上書きされる / remove は1件だけ', () => {
    const registry = new MutableMapServiceRegistry();
    const KeyA = createMapServiceKey();
    const KeyB = createMapServiceKey();

    assert.equal(registry.get(KeyA), null);
    registry.put(KeyA, 'first');
    registry.put(KeyA, 'second');
    assert.equal(registry.get(KeyA), 'second');

    registry.put(KeyB, 'b');
    registry.remove(KeyA);
    assert.equal(registry.get(KeyA), null);
    assert.equal(registry.get(KeyB), 'b', 'remove は他のキーに影響しないこと');

    registry.clear();
    assert.equal(registry.get(KeyB), null);
});
