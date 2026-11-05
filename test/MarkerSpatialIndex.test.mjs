// マーカーの空間インデックス（HexCellRegistry / KDTree）と、pointerdown での引き当て。
//
// ## なぜここを固定するか
//
// 数万件のマーカーを置いた地図で、マーカーを差し替えるたびに次の検索が K-D 木の
// 全件再構築を待っていた。pointerdown がその検索をするので、地図を触った瞬間に
// 0.8〜1.6 秒止まる（Pixel 5a の実測）。
//
// 速くしたことで結果が変わってはいけない。インデックスの取り違えは何も落とさず、
// マーカーが静かに見つからなくなるだけなので、総当たりの結果と毎回比べる。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    createHexCell,
    createMarkerEntity,
    createMarkerState,
    DefaultMarkerEventController,
    HexCellRegistry,
    HexGeocellImpl,
    KDTree,
    MarkerManager,
} from '../dist/index.mjs';

/** A deterministic spread, so a failure is reproducible. */
function random(seed = 123456789) {
    return () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
}

const cellAt = (id, x, y) =>
    createHexCell({
        coord: { q: 0, r: 0 },
        centerLatLng: { latitude: 0, longitude: 0 },
        centerXY: { x, y },
        id,
    });

const distSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** 六角格子のように、同じ x（列）と同じ y が大量に並ぶ点。分割の取り違えはここで出る */
function gridCells() {
    const cells = [];
    for (let col = 0; col < 40; col++) {
        for (let row = 0; row < 40; row++) {
            cells.push(cellAt(`c${col}_${row}`, col * 3, row * 2 + (col % 2)));
        }
    }
    return cells;
}

function scatteredCells(count) {
    const next = random();
    return Array.from({ length: count }, (_, i) => cellAt(`s${i}`, next() * 1000, next() * 1000));
}

for (const [name, cells] of [
    ['同じ座標が並ぶ格子', gridCells()],
    ['ばらばらの点', scatteredCells(3000)],
]) {
    test(`K-D 木は総当たりと同じ答えを返す（${name}）`, () => {
        const tree = new KDTree(cells);
        assert.equal(tree.getStats().nodeCount, cells.length);

        const next = random(42);
        for (let i = 0; i < 200; i++) {
            const query = { x: next() * 130 - 5, y: next() * 90 - 5 };

            const nearest = tree.nearest(query);
            const best = Math.min(...cells.map((c) => distSq(c.centerXY, query)));
            assert.equal(distSq(nearest.centerXY, query), best);

            const radius = next() * 10;
            const within = tree.withinRadiusWithDistance({ query, radius }).map((h) => h.cell.id).sort();
            const expected = cells
                .filter((c) => distSq(c.centerXY, query) <= radius * radius)
                .map((c) => c.id)
                .sort();
            assert.deepEqual(within, expected);

            const k = 1 + Math.floor(next() * 8);
            const knn = tree.nearestKWithDistance({ query, k }).map((h) => h.distanceMeters ** 2);
            const expectedKnn = cells
                .map((c) => distSq(c.centerXY, query))
                .sort((a, b) => a - b)
                .slice(0, k);
            assert.deepEqual(
                knn.map((d) => Math.round(d * 1e6)),
                expectedKnn.map((d) => Math.round(d * 1e6)),
            );
        }
    });
}

test('K-D 木は渡した配列を並べ替えない', () => {
    const cells = scatteredCells(100);
    const ids = cells.map((c) => c.id);
    new KDTree(cells);
    assert.deepEqual(
        cells.map((c) => c.id),
        ids,
    );
});

const geocell = HexGeocellImpl.defaultGeocell();

const entityAt = (id, latitude, longitude, extra = {}) =>
    createMarkerEntity({
        marker: null,
        state: createMarkerState({ id, position: { latitude, longitude }, ...extra }),
    });

const withinIds = (registry, position, radius) =>
    registry
        .findWithinRadiusWithDistance({ position, radius })
        .flatMap((h) => [...(registry.getEntryIDsByHexCell(h.cell) ?? [])])
        .sort();

test('セルの変わらない更新・同じセルへの追加と削除のあとも、作り直した索引と同じ答えを返す', () => {
    const registry = new HexCellRegistry({ geocell, zoom: 20 });
    const center = { latitude: 35.7078, longitude: 139.7615 };
    const next = random(7);
    const entities = Array.from({ length: 500 }, (_, i) =>
        entityAt(`p${i}`, center.latitude + (next() - 0.5) * 0.02, center.longitude + (next() - 0.5) * 0.02),
    );
    for (const e of entities) registry.setPoint(e);
    // 一度検索して木を作らせる（以降の更新で作り直しが要るかどうかを試す）
    assert.ok(registry.findNearest(center));

    // 位置の変わらない更新（セルの集合は変わらない）
    for (const e of entities) registry.setPoint(e);
    // 既存のマーカーと同じ位置への追加（既存のセルに入る）
    const twin = entityAt('twin', entities[0].state.position.latitude, entities[0].state.position.longitude);
    registry.setPoint(twin);
    // 1 件を遠くへ動かす（セルが消えて、新しいセルができる）
    const moved = entityAt('p1', center.latitude + 0.5, center.longitude + 0.5);
    registry.setPoint(moved);
    // 1 件を外す（セルが消える）
    registry.removePoint(entities[2]);

    const fresh = new HexCellRegistry({ geocell, zoom: 20 });
    for (const e of [...entities.filter((e) => !['p1', 'p2'].includes(e.state.id)), twin, moved]) {
        fresh.setPoint(e);
    }

    const probes = [center, moved.state.position, entities[0].state.position, entities[2].state.position];
    for (let i = 0; i < 50; i++) {
        probes.push({
            latitude: center.latitude + (next() - 0.5) * 0.03,
            longitude: center.longitude + (next() - 0.5) * 0.03,
        });
    }
    for (const position of probes) {
        for (const radius of [50, 300, 2000]) {
            assert.deepEqual(withinIds(registry, position, radius), withinIds(fresh, position, radius));
        }
        assert.equal(registry.findNearest(position)?.id, fresh.findNearest(position)?.id);
    }
    assert.ok(withinIds(registry, entities[0].state.position, 50).includes('twin'));
    assert.ok(registry.getEntryIDsByHexCell(registry.findNearest(moved.state.position)).has('p1'));

    // 同じセルに残りがある削除では、セルは残る
    registry.removePoint(twin);
    const stillThere = registry.findNearest(entities[0].state.position);
    assert.ok(registry.getEntryIDsByHexCell(stillThere).has('p0'));
    assert.ok(!registry.getEntryIDsByHexCell(stillThere).has('twin'));
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
