// マーカーの空間検索（MarkerManager）と、pointerdown での引き当て。
//
// ## なぜここを固定するか
//
// 数万件のマーカーを置いた地図で、マーカーを差し替えるたびに次の検索が K-D 木の
// 全件再構築を待っていた。pointerdown がその検索をするので、地図を触った瞬間に
// 0.8〜1.8 秒止まる（Pixel 5a の実測）。
//
// 索引は android-sdk / ios-sdk と同じ階層グリッド（MarkerGridIndex）に置き換えた。
// JS 版は足し引きをその場で反映する（作り直さない）ので、変更の前に一度検索して
// 索引を作らせてから変更し、その後の答えを確かめる。索引の取り違えは何も落とさず、
// マーカーが静かに見つからなくなるだけなので、総当たりの結果と毎回比べる。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    createGeoPoint,
    createGeoRectBounds,
    createMarkerEntity,
    createMarkerState,
    DefaultMarkerEventController,
    HexGeocellImpl,
    MarkerManager,
} from '../dist/index.mjs';

/** A deterministic spread, so a failure is reproducible. */
function random(seed = 123456789) {
    return () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
}

const geocell = HexGeocellImpl.defaultGeocell();

const entityAt = (id, latitude, longitude, extra = {}) =>
    createMarkerEntity({
        marker: null,
        state: createMarkerState({ id, position: createGeoPoint({ latitude, longitude }), ...extra }),
    });

const boundsOf = (south, west, north, east) =>
    createGeoRectBounds({
        southWest: createGeoPoint({ latitude: south, longitude: west }),
        northEast: createGeoPoint({ latitude: north, longitude: east }),
    });

const idsOf = (entities) => entities.map((e) => e.state.id).sort();

const distSq = (entity, p) =>
    (entity.state.position.latitude - p.latitude) ** 2 + (entity.state.position.longitude - p.longitude) ** 2;

/** 総当たりの答え。索引を使わない MarkerManager と同じ判定 */
function bruteForce(entities) {
    return {
        inBounds: (bounds) => entities.filter((e) => bounds.contains(e.state.position)),
        nearestDistSq: (p) => Math.min(...entities.map((e) => distSq(e, p))),
    };
}

function assertMatchesBruteForce(manager, entities, next) {
    const scan = bruteForce(entities);
    const boxes = [
        boundsOf(35.70, 139.75, 35.71, 139.77),
        boundsOf(35.6, 139.6, 35.8, 139.9),
        boundsOf(35.7078, 139.7615, 35.7079, 139.7616),
        boundsOf(10, 100, 11, 101),
    ];
    for (let i = 0; i < 30; i++) {
        const lat = 35.65 + next() * 0.12;
        const lng = 139.70 + next() * 0.12;
        const size = next() * 0.03;
        boxes.push(boundsOf(lat, lng, lat + size, lng + size));
    }
    for (const bounds of boxes) {
        assert.deepEqual(idsOf(manager.findMarkersInBounds(bounds)), idsOf(scan.inBounds(bounds)));
    }

    for (let i = 0; i < 100; i++) {
        const p = { latitude: 35.6 + next() * 0.2, longitude: 139.6 + next() * 0.3 };
        const found = manager.findNearest(p);
        assert.ok(found, 'nearest returned nothing');
        assert.equal(distSq(found, p), scan.nearestDistSq(p));
    }
    // 遠く離れた点（リングの外。総当たりに落ちる）
    const far = { latitude: 10, longitude: 100 };
    assert.equal(distSq(manager.findNearest(far), far), scan.nearestDistSq(far));
}

test('索引を使う件数で、範囲検索と最近傍が総当たりと一致する', () => {
    const next = random(7);
    const manager = new MarkerManager(geocell, 100);
    const entities = Array.from({ length: 5000 }, (_, i) =>
        entityAt(`p${i}`, 35.65 + next() * 0.12, 139.70 + next() * 0.12),
    );
    for (const e of entities) manager.registerEntity(e);

    assertMatchesBruteForce(manager, entities, random(42));
    assert.equal(manager.getMemoryStats().spatialIndexInitialized, true);
});

test('追加・更新・移動・削除のあとも、総当たりと一致する', () => {
    const next = random(11);
    const manager = new MarkerManager(geocell, 100);
    let entities = Array.from({ length: 3000 }, (_, i) =>
        entityAt(`p${i}`, 35.65 + next() * 0.12, 139.70 + next() * 0.12),
    );
    for (const e of entities) manager.registerEntity(e);
    // 先に同じ検索をして索引を作らせる（以降の変更はその場で反映される）
    assertMatchesBruteForce(manager, entities, random(43));

    // 消すもの・動かすものの位置でも、変更の前に検索しておく。索引は段ごとに作るので、
    // ここで作った段が変更で正しく直されるかを、変更の直後に確かめる。
    const removed = entities[2];
    const beforeMove = entities[1].state.position;
    const around = (at) => boundsOf(at.latitude - 1e-4, at.longitude - 1e-4, at.latitude + 1e-4, at.longitude + 1e-4);
    const probes = [['p2', removed.state.position], ['p1', beforeMove]];
    for (const [id, at] of probes) {
        assert.ok(idsOf(manager.findMarkersInBounds(around(at))).includes(id), id);
        assert.equal(manager.findNearest(at)?.state.id, id);
    }

    // 位置の変わらない更新
    for (const e of entities.slice(0, 500)) manager.updateEntity(e);
    // 既存のマーカーと同じ位置への追加
    const twin = entityAt('twin', entities[0].state.position.latitude, entities[0].state.position.longitude);
    manager.registerEntity(twin);
    // 遠くへ動かす（別のエンティティで置き換え）
    const moved = entityAt('p1', 35.9, 140.0);
    manager.updateEntity(moved);
    // 外す
    manager.removeEntity('p2');
    // 新規
    const added = Array.from({ length: 200 }, (_, i) =>
        entityAt(`n${i}`, 35.65 + next() * 0.12, 139.70 + next() * 0.12),
    );
    for (const e of added) manager.registerEntity(e);

    // 消したものと、動かす前の位置には、もう何も残っていない（他の検索より先に見る）
    for (const [id, at] of probes) {
        assert.ok(!idsOf(manager.findMarkersInBounds(around(at))).includes(id), id);
        assert.notEqual(manager.findNearest(at)?.state.id, id);
    }

    entities = [...entities.filter((e) => !['p1', 'p2'].includes(e.state.id)), twin, moved, ...added];
    assertMatchesBruteForce(manager, entities, random(43));
    assert.equal(manager.findNearest({ latitude: 35.9, longitude: 140.0 })?.state.id, 'p1');

    assert.ok(idsOf(manager.findMarkersInBounds(boundsOf(35.89, 139.99, 35.91, 140.01))).includes('p1'));
});

test('その場で書き換えた位置は、updateEntity のあとの検索に反映される', () => {
    const next = random(13);
    const manager = new MarkerManager(geocell, 100);
    const entities = Array.from({ length: 1000 }, (_, i) =>
        entityAt(`p${i}`, 35.65 + next() * 0.12, 139.70 + next() * 0.12),
    );
    for (const e of entities) manager.registerEntity(e);
    assert.ok(manager.findNearest({ latitude: 35.7, longitude: 139.75 }));
    assert.deepEqual(manager.findMarkersInBounds(boundsOf(36.4, 140.4, 36.6, 140.6)), []);

    // ドラッグと同じく MarkerState をその場で書き換え、updateEntity で知らせる
    entities[0].state.position = createGeoPoint({ latitude: 36.5, longitude: 140.5 });
    manager.updateEntity(entities[0]);

    assert.equal(manager.findNearest({ latitude: 36.5, longitude: 140.5 })?.state.id, 'p0');
    assert.deepEqual(idsOf(manager.findMarkersInBounds(boundsOf(36.4, 140.4, 36.6, 140.6))), ['p0']);
});

test('同じセルのまま差し替えたエンティティは、新しいものが返る', () => {
    const manager = new MarkerManager(geocell, 1);
    manager.registerEntity(entityAt('a', 35.68, 139.76));
    manager.registerEntity(entityAt('b', 35.0, 139.0));
    const box = boundsOf(35.67, 139.75, 35.69, 139.77);
    assert.deepEqual(idsOf(manager.findMarkersInBounds(box)), ['a']);

    const replacement = entityAt('a', 35.68, 139.76);
    manager.updateEntity(replacement);
    assert.equal(manager.findMarkersInBounds(box)[0], replacement);
    assert.equal(manager.findNearest(createGeoPoint({ latitude: 35.68, longitude: 139.76 })), replacement);
});

/**
 * リングは正方形なので、角で見つかったものは辺で見つかったものより遠いことがある。
 * 最初に当たるのはリング 1 の角（約 2.05 セル先）だが、本当の最近傍はリング 2 の辺
 * （1.6 セル先）にある。最初に当たったリングで打ち切ると角を返す。
 */
test('最近傍は、先に当たったリングの角より遠いリングの辺を見落とさない', () => {
    const cell = 180 / 2 ** 15; // MarkerGridIndex の最近傍の段
    // セルの真ん中。行は -90 度から、列は -180 度から数える
    const centre = createGeoPoint({
        latitude: -90 + (Math.floor((35 + 90) / cell) + 0.5) * cell,
        longitude: -180 + (Math.floor((139 + 180) / cell) + 0.5) * cell,
    });
    const manager = new MarkerManager(geocell, 1);
    manager.registerEntity(entityAt('corner', centre.latitude + cell * 1.45, centre.longitude + cell * 1.45));
    manager.registerEntity(entityAt('edge', centre.latitude, centre.longitude + cell * 1.6));
    assert.equal(manager.findNearest(centre)?.state.id, 'edge');
});

test('180 度をまたぐ範囲でも、総当たりと一致する', () => {
    const next = random(17);
    const manager = new MarkerManager(geocell, 10);
    const entities = Array.from({ length: 400 }, (_, i) =>
        entityAt(`p${i}`, -1 + next() * 2, ((179 + next() * 2 + 180) % 360) - 180),
    );
    for (const e of entities) manager.registerEntity(e);
    const scan = bruteForce(entities);
    const bounds = boundsOf(-0.5, 179.5, 0.5, -179.5);
    const found = idsOf(manager.findMarkersInBounds(bounds));
    assert.ok(found.length > 0);
    assert.deepEqual(found, idsOf(scan.inBounds(bounds)));

    const p = { latitude: 0, longitude: 179.999 };
    assert.equal(distSq(manager.findNearest(p), p), scan.nearestDistSq(p));
});

test('clear と destroy のあとは何も返さない', () => {
    const manager = new MarkerManager(geocell, 1);
    manager.registerEntity(entityAt('a', 35, 139));
    manager.registerEntity(entityAt('b', 35.1, 139.1));
    manager.registerEntity(entityAt('c', 35.2, 139.2));
    assert.equal(manager.findNearest({ latitude: 35, longitude: 139 })?.state.id, 'a');

    manager.clear();
    assert.equal(manager.findNearest({ latitude: 35, longitude: 139 }), null);
    assert.deepEqual(manager.findMarkersInBounds(boundsOf(34, 138, 36, 140)), []);

    manager.registerEntity(entityAt('d', 35, 139));
    manager.destroy();
    assert.equal(manager.findNearest({ latitude: 35, longitude: 139 }), null);
});

test('ドラッグできるマーカーがあるかは、その場の書き換えも反映する', () => {
    const manager = new MarkerManager(geocell);
    const entity = entityAt('a', 35, 139);
    manager.registerEntity(entity);
    manager.registerEntity(entityAt('b', 35.1, 139.1));
    assert.equal(manager.hasDraggableEntity(), false);

    entity.state.draggable = true;
    assert.equal(manager.hasDraggableEntity(), true);

    manager.removeEntity('a');
    assert.equal(manager.hasDraggableEntity(), false);
});

/** pointerdown だけを見る最小の host と canvas */
function fakeHost({ hasDraggableMarker }) {
    const listeners = new Map();
    const canvas = {
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        setPointerCapture: () => {},
        hasPointerCapture: () => false,
        releasePointerCapture: () => {},
    };
    const calls = { find: 0 };
    const host = {
        findWithZoom: () => {
            calls.find++;
            return null;
        },
        getSelectedMarker: () => null,
        setSelectedMarker: () => {},
        updateSelectedPosition: () => {},
        renderer: {
            holder: {
                map: {
                    getCanvas: () => canvas,
                    getZoom: () => 15,
                    getLayer: () => ({}),
                    dragPan: { isEnabled: () => true, enable: () => {}, disable: () => {} },
                },
                fromScreenOffsetSync: () => ({ latitude: 35, longitude: 139 }),
            },
            markerLayer: { layerId: 'markers' },
        },
        ...(hasDraggableMarker && { hasDraggableMarker }),
    };
    const controller = new DefaultMarkerEventController(host);
    const pointerDown = (pointerType = 'touch') =>
        listeners.get('pointerdown')({ isPrimary: true, button: 0, pointerId: 1, pointerType, clientX: 10, clientY: 10 });
    return { controller, calls, pointerDown };
}

test('掴めるマーカーが無ければ、pointerdown で引き当てない', () => {
    const { controller, calls, pointerDown } = fakeHost({ hasDraggableMarker: () => false });
    pointerDown('touch');
    assert.equal(calls.find, 0);
    // タップの当たり半径に使うので、ポインタ種別は覚えておく
    assert.equal(controller.lastPointerType, 'touch');
});

test('掴めるマーカーがあれば、pointerdown で引き当てる', () => {
    const { calls, pointerDown } = fakeHost({ hasDraggableMarker: () => true });
    pointerDown();
    assert.equal(calls.find, 1);
});

test('hasDraggableMarker を持たない host は、従来どおり毎回引き当てる', () => {
    const { calls, pointerDown } = fakeHost({});
    pointerDown();
    assert.equal(calls.find, 1);
});
