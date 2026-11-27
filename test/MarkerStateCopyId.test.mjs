import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGeoPoint, createMarkerState } from '../dist/index.mjs';

// copy() は id を引き継がず、新しい中身から計算し直す。描画側はマーカーを id で区別するので、
// 引き継ぐと copy で増やしたマーカーが元のマーカーを上書きし、1 個にしか見えなかった。
// android-sdk / ios-sdk と同じ意味論。

const at = (latitude, longitude) => createGeoPoint({ latitude, longitude });

test('copy() で位置を変えると id も変わる', () => {
    const base = createMarkerState({ position: at(35.0, 139.0) });
    const moved = base.copy({ position: at(36.0, 140.0) });

    assert.notEqual(moved.id, base.id);
    assert.equal(moved.id, createMarkerState({ position: at(36.0, 140.0) }).id);
});

test('明示した id があっても copy() は引き継がない', () => {
    const base = createMarkerState({ id: 'm1', position: at(35.0, 139.0) });

    assert.notEqual(base.copy({ position: at(36.0, 140.0) }).id, 'm1');
});

test('copy() に id を渡せばその id になる', () => {
    const base = createMarkerState({ id: 'm1', position: at(35.0, 139.0) });

    assert.equal(base.copy({ id: 'm1', position: at(36.0, 140.0) }).id, 'm1');
    assert.equal(base.copy({ id: 'm2' }).id, 'm2');
});

test('id: null は渡さないのと同じで計算し直す', () => {
    const base = createMarkerState({ id: 'm1', position: at(35.0, 139.0) });

    assert.equal(base.copy({ id: null }).id, base.copy().id);
});
