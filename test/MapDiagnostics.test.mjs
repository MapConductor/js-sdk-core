import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { capabilityOfGesture, MapDiagnostics, MapUISettingsDiagnostics } from '../dist/index.mjs';

/**
 * {@link MapDiagnostics} の意味論テスト。
 *
 * android-sdk の `MapDiagnosticsTest`、ios-sdk の `MapDiagnosticsTests` と
 * 1 対 1 で対応する。元の `MapUISettingsDiagnostics.warnIfRequested` が持っていた
 * 2 つの性質（要求されたときだけ / provider+capability ごとに 1 回だけ）を、
 * 一般化後も保っていることを押さえる。あわせて既存の warnIfRequested が同じ挙動の
 * ままであることも確認する（公開 API なので壊せない）。
 */

let messages = [];

beforeEach(() => {
    messages = [];
    MapDiagnostics.setSink((message) => messages.push(message));
    MapDiagnostics.resetWarnings();
});

test('report は 1 回だけ出力する', () => {
    assert.equal(MapDiagnostics.report('groundImage', 'unsupported', 'Longdo', 'no ground overlay API'), true);
    assert.equal(MapDiagnostics.report('groundImage', 'unsupported', 'Longdo', 'no ground overlay API'), false);
    assert.equal(messages.length, 1);
});

test('provider が違えばそれぞれ出力する', () => {
    MapDiagnostics.report('groundImage', 'unsupported', 'Longdo', 'x');
    MapDiagnostics.report('groundImage', 'unsupported', 'MapTiler', 'y');
    assert.equal(messages.length, 2);
});

test('level が違えばそれぞれ出力する', () => {
    MapDiagnostics.report('polygonHoles', 'degraded', 'HERE', 'union fill');
    MapDiagnostics.report('polygonHoles', 'unsupported', 'HERE', 'union fill');
    assert.equal(messages.length, 2);
});

test('reportIfRequested は要求されていなければ黙る', () => {
    assert.equal(MapDiagnostics.reportIfRequested(false, 'markerDrag', 'unsupported', 'Longdo', 'no drag'), false);
    assert.equal(messages.length, 0);
});

test('subject を省略すると capability そのものが出る', () => {
    MapDiagnostics.report('markerDrag', 'unsupported', 'Longdo', 'no drag');
    assert.equal(messages[0], 'markerDrag is not supported by Longdo (no drag); the request is ignored.');
});

test('resetWarnings 後は再び出力する', () => {
    MapDiagnostics.report('marker', 'unsupported', 'P', 'r');
    MapDiagnostics.resetWarnings();
    MapDiagnostics.report('marker', 'unsupported', 'P', 'r');
    assert.equal(messages.length, 2);
});

// ── 既存 API の非破壊 ───────────────────────────────────────────────────

test('warnIfRequested は無効化を要求されたときだけ警告する', () => {
    // true = ジェスチャを有効のままにしたい → 常に達成できるので警告不要。
    MapUISettingsDiagnostics.warnIfRequested(true, 'rotate', 'MapTiler', 'single handler');
    assert.equal(messages.length, 0);

    // false = 無効化したいができない → 警告する。
    MapUISettingsDiagnostics.warnIfRequested(false, 'rotate', 'MapTiler', 'single handler');
    assert.equal(messages.length, 1);
});

test('warnIfRequested のメッセージは設定名を使う', () => {
    MapUISettingsDiagnostics.warnIfRequested(false, 'scroll', 'MapTiler', 'single handler');
    assert.equal(messages[0], 'scrollGesture cannot be changed on MapTiler (single handler); the setting is ignored.');
});

test('warnIfRequested は provider とジェスチャごとに 1 回だけ', () => {
    for (let i = 0; i < 5; i += 1) {
        MapUISettingsDiagnostics.warnIfRequested(false, 'tilt', 'MapTiler', 'r');
    }
    MapUISettingsDiagnostics.warnIfRequested(false, 'zoom', 'MapTiler', 'r');
    MapUISettingsDiagnostics.warnIfRequested(false, 'tilt', 'Longdo', 'r');
    assert.equal(messages.length, 3);
});

test('MapGesture は対応する capability を持つ', () => {
    assert.equal(capabilityOfGesture('scroll'), 'gestureScroll');
    assert.equal(capabilityOfGesture('zoom'), 'gestureZoom');
    assert.equal(capabilityOfGesture('rotate'), 'gestureRotate');
    assert.equal(capabilityOfGesture('tilt'), 'gestureTilt');
});
