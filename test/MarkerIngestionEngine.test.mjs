import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    HexGeocellImpl,
    MarkerManager,
    createGeoPoint,
    createMarkerState,
    ingestMarkers,
} from '../dist/index.mjs';

/**
 * 同じ見た目・同じ id で作り直された MarkerState を、エンティティが受け取り直すこと。
 *
 * ## なぜここを固定するか
 *
 * `createMarkerState({ position, onClick })` の id は **見た目のハッシュ**
 * （position / icon / clickable / draggable / animation）で、ハンドラは入らない。
 * React 側で毎レンダー作り直せば「同じ id・同じ fingerprint・別オブジェクト」が届く。
 *
 * 描画をやり直さないのは正しい最適化だが、エンティティが古いオブジェクトを
 * 持ち続けると **クリックが前回の onClick へ配送される**。dispatchClick が読むのは
 * `entity.state` だからで、購読は `OverlayCollector.add()` が新しい方へ移している
 * ので、古い state に `animate()` してももう誰も見ていない。
 *
 * 症状はプレイグラウンドのホットリロードで出た: ⌘S のたびにハンドラだけが差し替わる
 * コードで、クリックが効かなくなる。地図を作り直すと直る、という形で。
 *
 * Polygon / Polyline / Circle / GroundImage の各コントローラは以前から
 * 「描画は据え置き、state だけ最新に」を同じ位置でやっている。マーカーだけが
 * 揃っていなかった。
 */

function manager() {
    return new MarkerManager(HexGeocellImpl.defaultGeocell());
}

/** 何も描かない renderer。取り込みの判断だけを見たいので、呼ばれた回数を数える。 */
function renderer() {
    const calls = { add: 0, change: 0, remove: 0 };
    return {
        calls,
        async onAdd(data) {
            calls.add += data.length;
            return data.map(() => ({}));
        },
        async onChange(data) {
            calls.change += data.length;
            return data.map(({ current }) => current.marker ?? {});
        },
        async onRemove(data) {
            calls.remove += data.length;
        },
        async onPostProcess() {},
        async onAnimate() {},
    };
}

const POSITION = createGeoPoint({ latitude: 35.681236, longitude: 139.767125 });

const ingest = (markerManager, view, data) =>
    ingestMarkers({
        data,
        markerManager,
        renderer: view,
        defaultMarkerIcon: { width: 1, height: 1, data: new Uint8Array(4) },
        tilingEnabled: false,
        tiledMarkerIds: new Set(),
        shouldTile: () => false,
    });

test('a redrawn-identical marker keeps its rendering and adopts the new state', async () => {
    const markerManager = manager();
    const view = renderer();

    let clicked = 'none';
    const first = createMarkerState({ position: POSITION, onClick: () => { clicked = 'first'; } });
    await ingest(markerManager, view, [first]);

    const second = createMarkerState({ position: POSITION, onClick: () => { clicked = 'second'; } });
    // 同じ見た目なので id も fingerprint も一致する。ここが前提。
    assert.equal(second.id, first.id);
    assert.notEqual(second, first);

    await ingest(markerManager, view, [second]);

    const entity = markerManager.getEntity(first.id);
    assert.ok(entity);
    // 描画はやり直さない。
    assert.equal(view.calls.change, 0);
    assert.equal(view.calls.remove, 0);
    // それでも state は最新のものになっている。
    assert.equal(entity.state, second);

    entity.state.onClick?.(entity.state);
    assert.equal(clicked, 'second');
});

test('a marker whose look changed still goes through the renderer', async () => {
    const markerManager = manager();
    const view = renderer();

    const first = createMarkerState({ id: 'pin', position: POSITION });
    await ingest(markerManager, view, [first]);

    const moved = createMarkerState({
        id: 'pin',
        position: createGeoPoint({ latitude: 35.7, longitude: 139.8 }),
    });
    await ingest(markerManager, view, [moved]);

    assert.equal(view.calls.change, 1);
    assert.equal(markerManager.getEntity('pin').state, moved);
});
