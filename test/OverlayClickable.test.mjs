import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createGeoPoint,
    createGeoRectBounds,
    createGroundImageState,
    createPolygonState,
    createPolylineState,
    GroundImageManager,
    PolygonManager,
    PolylineManager,
} from '../dist/index.mjs';

/**
 * `clickable=false` は透過。
 *
 * そのオーバーレイはタップを受け取らず、下のオーバーレイ（無ければ地図クリック）へ
 * 流れる。判定は各 Manager の `find` にあるので、どのプロバイダでも同じになる。
 * CircleManager が元々そう振る舞っていたのに揃えた。
 */

const square = [
    createGeoPoint({ latitude: 0, longitude: 0 }),
    createGeoPoint({ latitude: 0, longitude: 1 }),
    createGeoPoint({ latitude: 1, longitude: 1 }),
    createGeoPoint({ latitude: 1, longitude: 0 }),
];
const inside = createGeoPoint({ latitude: 0.5, longitude: 0.5 });

test('既定は clickable=true', () => {
    assert.equal(createPolygonState({ points: square }).clickable, true);
    assert.equal(createPolylineState({ points: square }).clickable, true);
    const bounds = createGeoRectBounds({ southWest: square[0], northEast: square[2] });
    assert.equal(createGroundImageState({ bounds, imageUrl: 'x' }).clickable, true);
});

test('clickable=false のポリゴンは下のポリゴンへ透過する', () => {
    const manager = new PolygonManager();
    const below = createPolygonState({ id: 'below', points: square, zIndex: 0 });
    const above = createPolygonState({ id: 'above', points: square, zIndex: 1, clickable: false });
    manager.registerEntity({ state: below });
    manager.registerEntity({ state: above });
    assert.equal(manager.find(inside)?.state.id, 'below');

    // 描画に関わらないので setter で即座に効く。
    above.clickable = true;
    assert.equal(manager.find(inside)?.state.id, 'above');
});

test('clickable=false のポリラインは当たらない', () => {
    const manager = new PolylineManager();
    const line = createPolylineState({ id: 'line', points: [square[0], square[1]], clickable: false });
    manager.registerEntity({ state: line });
    const onLine = createGeoPoint({ latitude: 0, longitude: 0.5 });
    assert.equal(manager.find(onLine, null), null);
    line.clickable = true;
    assert.equal(manager.find(onLine, null)?.entity.state.id, 'line');
});

test('clickable=false のグラウンドイメージは当たらない', () => {
    const manager = new GroundImageManager();
    const bounds = createGeoRectBounds({ southWest: square[0], northEast: square[2] });
    const image = createGroundImageState({ id: 'image', bounds, imageUrl: 'x', clickable: false });
    manager.registerEntity({ state: image });
    assert.equal(manager.find(inside), null);
    image.clickable = true;
    assert.equal(manager.find(inside)?.state.id, 'image');
});

test('clickable を変えると通知する（ネイティブの clickable へ渡すプロバイダのため）', () => {
    const bounds = createGeoRectBounds({ southWest: square[0], northEast: square[2] });
    for (const state of [
        createPolygonState({ id: 'p', points: square }),
        createPolylineState({ id: 'l', points: square }),
        createGroundImageState({ id: 'g', bounds, imageUrl: 'x' }),
    ]) {
        const before = state.fingerPrint();
        let notified = 0;
        const unsubscribe = state.asObservable().subscribe(() => { notified += 1; });
        const initial = notified;
        state.clickable = false;
        unsubscribe();
        assert.notDeepEqual(state.fingerPrint(), before);
        assert.equal(notified, initial + 1);
    }
});
