import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    AbstractMarkerController,
    CircleController,
    CircleManager,
    createCircleState,
    createGeoPoint,
    createGeoRectBounds,
    createGroundImageState,
    createMarkerEntity,
    createMarkerState,
    createPolygonState,
    createPolylineState,
    createRasterLayerState,
    GroundImageController,
    GroundImageManager,
    HexGeocellImpl,
    MarkerManager,
    PolygonController,
    PolygonManager,
    PolylineController,
    PolylineManager,
    RasterLayerController,
    RasterLayerManager,
    RasterLayerSource,
    StrategyMarkerController,
} from '../dist/index.mjs';

/**
 * 各オーバーレイの state の `onAdded`。
 *
 * - ネイティブ描画: renderer.onAdd が返った後に 1 回。
 * - タイル描画: タイルの URL テンプレートが地図に渡った（upsert が返った）後に 1 回。
 * - その場の変更・ネイティブ⇔タイルの切り替えでは呼ばない。remove → add で再び呼ぶ。
 * - clear では呼ばない。onAdded を差し替えても描き直さない。
 * - 例外を投げても他のオーバーレイは追加され、他の onAdded も呼ばれる。
 *
 * renderer は呼ばれた順を `log` に書くだけの偽物で、地図の SDK は要らない。
 */

// 例外は reportError（node には無いので console.error）へ流れる。テストの出力を汚さない。
function quietErrors() {
    const errors = [];
    const original = console.error;
    console.error = (error) => errors.push(error);
    return { errors, restore: () => { console.error = original; } };
}

function fakeRenderer(log, kind) {
    return {
        async onAdd(data) {
            log.push(`${kind}.onAdd:${data.map((d) => d.state.id).join(',')}`);
            return data.map((d) => ({ id: d.state.id }));
        },
        async onChange(data) {
            log.push(`${kind}.onChange:${data.map((d) => d.current.state.id).join(',')}`);
            return data.map((d) => ({ id: d.current.state.id }));
        },
        async onRemove(data) {
            log.push(`${kind}.onRemove:${data.map((e) => e.state.id).join(',')}`);
        },
        async onPostProcess() {},
        async onCameraChanged() {},
        async onAnimate() {},
        animateStartListener: null,
        animateEndListener: null,
    };
}

const p = (lat, lng) => createGeoPoint({ latitude: lat, longitude: lng });
const square = (i) => [p(0, i), p(0, i + 0.5), p(0.5, i + 0.5), p(0.5, i)];

// ── ポリゴン ──────────────────────────────────────────────────────────────

class Polygons extends PolygonController {}

/**
 * PolygonTiler と同じ形の偽物。`tileIds` に入っている id をタイルへ回し、
 * route() の中でテンプレートを「地図に渡す」（log に書く）。
 */
function fakeTiler(log, tileIds) {
    let states = [];
    return {
        async route(data) {
            states = data.filter((s) => tileIds.has(s.id));
            await Promise.resolve();
            log.push(states.length > 0 ? 'tiles.upsert' : 'tiles.remove');
            return new Set(states.map((s) => s.id));
        },
        tiledStates: () => states,
        isTiled: (id) => states.some((s) => s.id === id),
        update(state) { log.push(`tiles.update:${state.id}`); },
        async clear() { states = []; log.push('tiles.remove'); },
    };
}

function polygonFixture(tileIds = null) {
    const log = [];
    const controller = new Polygons({ polygonManager: new PolygonManager(), renderer: fakeRenderer(log, 'polygon') });
    if (tileIds) controller.tiler = fakeTiler(log, tileIds);
    const polygon = (id, extra = {}) =>
        createPolygonState({
            id,
            points: square(Number(id.replace(/\D/g, '')) || 0),
            onAdded: (state) => log.push(`onAdded:${state.id}`),
            ...extra,
        });
    return { log, controller, polygon };
}

test('ネイティブ描画のポリゴン: renderer.onAdd の後に 1 回ずつ', async () => {
    const f = polygonFixture();
    await f.controller.composition([f.polygon('a1'), f.polygon('b2')]);
    assert.deepEqual(f.log, ['polygon.onAdd:a1,b2', 'onAdded:a1', 'onAdded:b2']);
});

test('タイル描画のポリゴン: テンプレートを地図に渡した後に 1 回ずつ', async () => {
    const f = polygonFixture(new Set(['a1', 'b2']));
    await f.controller.composition([f.polygon('a1'), f.polygon('b2'), f.polygon('c3')]);
    assert.deepEqual(f.log, ['tiles.upsert', 'polygon.onAdd:c3', 'onAdded:c3', 'onAdded:a1', 'onAdded:b2']);
});

test('ポリゴン: その場の変更・同じ一覧の再送では呼ばない', async () => {
    for (const tiles of [null, new Set(['a1'])]) {
        const f = polygonFixture(tiles);
        const a = f.polygon('a1');
        await f.controller.composition([a]);
        f.log.length = 0;
        a.fillColor = '#ff0000';
        await f.controller.update(a);
        await f.controller.composition([a]);
        await f.controller.composition([f.polygon('a1', { fillColor: '#00ff00' })]);
        assert.equal(f.log.filter((l) => l.startsWith('onAdded')).length, 0, String(f.log));
    }
});

test('ポリゴン: ネイティブ ⇔ タイルの切り替えでは呼ばない', async () => {
    const tileIds = new Set();
    const f = polygonFixture(tileIds);
    const a = f.polygon('a1');
    await f.controller.composition([a]);
    assert.deepEqual(f.log, ['tiles.remove', 'polygon.onAdd:a1', 'onAdded:a1']);
    f.log.length = 0;
    tileIds.add('a1');
    await f.controller.composition([a]);
    tileIds.delete('a1');
    await f.controller.composition([a]);
    assert.deepEqual(f.log, ['tiles.upsert', 'polygon.onRemove:a1', 'tiles.remove', 'polygon.onAdd:a1']);
});

test('ポリゴン: remove の後に再び add されたら、もう一度呼ぶ。clear では呼ばない', async () => {
    for (const tiles of [null, new Set(['a1'])]) {
        const f = polygonFixture(tiles);
        const a = f.polygon('a1');
        await f.controller.composition([a]);
        await f.controller.composition([]);
        await f.controller.composition([a]);
        await f.controller.clear();
        assert.deepEqual(f.log.filter((l) => l.startsWith('onAdded')), ['onAdded:a1', 'onAdded:a1']);
        await f.controller.composition([a]);
        assert.deepEqual(f.log.filter((l) => l.startsWith('onAdded')), ['onAdded:a1', 'onAdded:a1', 'onAdded:a1']);
    }
});

test('ポリゴン: onAdded が例外を投げても他は追加され、他の onAdded も呼ばれる', async () => {
    const quiet = quietErrors();
    try {
        const f = polygonFixture();
        const boom = f.polygon('a1', { onAdded: () => { throw new Error('boom'); } });
        await f.controller.composition([boom, f.polygon('b2')]);
        assert.deepEqual(f.log, ['polygon.onAdd:a1,b2', 'onAdded:b2']);
        assert.equal(f.controller.polygonManager.hasEntity('a1'), true);
        assert.equal(f.controller.polygonManager.hasEntity('b2'), true);
        assert.equal(quiet.errors.length, 1);
        assert.equal(quiet.errors[0].message, 'boom');
        // 次の追加も止まらない。
        await f.controller.composition([boom, f.polygon('b2'), f.polygon('c3')]);
        assert.deepEqual(f.log.slice(-2), ['polygon.onAdd:c3', 'onAdded:c3']);
    } finally {
        quiet.restore();
    }
});

test('ポリゴン: onAdded は id・fingerprint・hash に入らず、差し替えても描き直さない', async () => {
    const f = polygonFixture();
    const a = f.polygon('a1');
    const before = { fp: a.fingerPrint(), hash: a.hashCode() };
    const fps = [];
    a.asObservable().subscribe((fp) => fps.push(fp));
    a.onAdded = () => {};
    assert.deepEqual(a.fingerPrint(), before.fp);
    assert.equal(a.hashCode(), before.hash);
    assert.equal(fps.length, 1); // 購読時の 1 回だけ
    const noId = { points: square(3) };
    assert.equal(
        createPolygonState({ ...noId, onAdded: () => {} }).id,
        createPolygonState(noId).id,
    );
    assert.ok(a.equals(a.copy({ onAdded: null })));
    // copy は onAdded を引き継ぎ、明示すれば差し替える。
    assert.equal(a.copy().onAdded, a.onAdded);
    assert.equal(a.copy({ onAdded: null }).onAdded, null);
});

// ── マーカー ──────────────────────────────────────────────────────────────

class Markers extends AbstractMarkerController {
    constructor(log, tileAll) {
        super({ markerManager: new MarkerManager(HexGeocellImpl.defaultGeocell(), 100), renderer: fakeRenderer(log, 'marker') });
        this.log = log;
        this.tileAll = tileAll;
    }
    shouldTile() { return this.tileAll; }
    async onTiledMarkersChanged() {
        await Promise.resolve();
        this.log.push('tiles.upsert');
    }
}

function markerFixture(tileAll) {
    const log = [];
    const controller = new Markers(log, tileAll);
    const marker = (id, lat = 0) =>
        createMarkerState({ id, position: p(lat, 0), onAdded: (state) => log.push(`onAdded:${state.id}`) });
    return { log, controller, marker };
}

test('ネイティブ描画のマーカー: renderer.onAdd の後に 1 回ずつ', async () => {
    const f = markerFixture(false);
    await f.controller.composition([f.marker('m1'), f.marker('m2')]);
    assert.deepEqual(f.log, ['marker.onAdd:m1,m2', 'onAdded:m1', 'onAdded:m2']);
});

test('タイル描画のマーカー: タイルを地図に渡した後に 1 回ずつ', async () => {
    const f = markerFixture(true);
    await f.controller.composition([f.marker('m1'), f.marker('m2')]);
    assert.deepEqual(f.log, ['tiles.upsert', 'onAdded:m1', 'onAdded:m2']);
});

test('マーカー: 変更・切り替えでは呼ばず、remove → add で再び呼ぶ。clear では呼ばない', async () => {
    const f = markerFixture(false);
    const m = f.marker('m1');
    await f.controller.composition([m]);
    m.position = p(1, 1);
    await f.controller.update(m);
    await f.controller.composition([f.marker('m1', 2)]);
    f.controller.tileAll = true;
    await f.controller.composition([m]);
    f.controller.tileAll = false;
    await f.controller.composition([m]);
    assert.deepEqual(f.log.filter((l) => l.startsWith('onAdded')), ['onAdded:m1']);
    await f.controller.composition([]);
    await f.controller.composition([m]);
    await f.controller.clear();
    assert.deepEqual(f.log.filter((l) => l.startsWith('onAdded')), ['onAdded:m1', 'onAdded:m1']);
});

test('マーカー: onAdded が例外を投げても他は追加される。fingerprint には入らない', async () => {
    const quiet = quietErrors();
    try {
        const f = markerFixture(false);
        const boom = createMarkerState({ id: 'x', position: p(0, 0), onAdded: () => { throw new Error('boom'); } });
        await f.controller.composition([boom, f.marker('m2')]);
        assert.deepEqual(f.log, ['marker.onAdd:x,m2', 'onAdded:m2']);
        assert.equal(f.controller.markerManager.hasEntity('x'), true);
        assert.equal(quiet.errors.length, 1);
        const fp = boom.fingerPrint();
        boom.onAdded = null;
        assert.deepEqual(boom.fingerPrint(), fp);
    } finally {
        quiet.restore();
    }
});

test('ストラテジ駆動のマーカー（クラスタ等）: 新しく管理下に入ったものだけ、カメラ待ちの後でも 1 回', async () => {
    const log = [];
    const manager = new MarkerManager(HexGeocellImpl.defaultGeocell(), 100);
    const strategy = {
        markerManager: manager,
        async onAdd({ data }) {
            const ids = new Set(data.map((s) => s.id));
            for (const e of manager.allEntities()) if (!ids.has(e.state.id)) manager.removeEntity(e.state.id);
            for (const state of data) manager.registerEntity(createMarkerEntity({ marker: null, state, visible: true, isRendered: true }));
            log.push('strategy.onAdd');
        },
        async onUpdate() {},
        async onCameraChanged() {},
        clear() { manager.clear(); },
    };
    const controller = new StrategyMarkerController({ strategy, renderer: fakeRenderer(log, 'marker') });
    const marker = (id) => createMarkerState({ id, position: p(0, 0), onAdded: (state) => log.push(`onAdded:${state.id}`) });
    const m1 = marker('m1');
    await controller.add([m1]); // カメラがまだ無い: 保留
    assert.deepEqual(log, []);
    await controller.onCameraChanged({ visibleRegion: { bounds: createGeoRectBounds({ southWest: p(-1, -1), northEast: p(1, 1) }) } });
    assert.deepEqual(log, ['strategy.onAdd', 'onAdded:m1']);
    await controller.add([m1, marker('m2')]);
    await controller.add([marker('m2')]);
    await controller.add([m1, marker('m2')]);
    assert.deepEqual(log.filter((l) => l.startsWith('onAdded')), ['onAdded:m1', 'onAdded:m2', 'onAdded:m1']);
});

// ── 円・線・地表画像・ラスター ─────────────────────────────────────────────

class Circles extends CircleController {}
class Polylines extends PolylineController {}
class GroundImages extends GroundImageController {}
class Rasters extends RasterLayerController {}

const kinds = [
    {
        name: '円',
        make: (log) => new Circles({ circleManager: new CircleManager(), renderer: fakeRenderer(log, 'circle') }),
        state: (id, onAdded, v = 1) => createCircleState({ id, center: p(0, 0), radiusMeters: 100 * v, onAdded }),
        change: (s) => { s.radiusMeters = 999; },
    },
    {
        name: '線',
        make: (log) => new Polylines({ polylineManager: new PolylineManager(), renderer: fakeRenderer(log, 'polyline') }),
        state: (id, onAdded, v = 1) => createPolylineState({ id, points: [p(0, 0), p(v, v)], onAdded }),
        change: (s) => { s.strokeWidth = 9; },
    },
    {
        name: '地表画像',
        make: (log) => new GroundImages({ groundImageManager: new GroundImageManager(), renderer: fakeRenderer(log, 'groundImage') }),
        state: (id, onAdded, v = 1) =>
            createGroundImageState({
                id,
                bounds: createGeoRectBounds({ southWest: p(0, 0), northEast: p(v, v) }),
                imageUrl: 'https://example.com/a.png',
                onAdded,
            }),
        change: (s) => { s.opacity = 0.3; },
    },
    {
        name: 'ラスター',
        make: (log) => new Rasters({ rasterLayerManager: new RasterLayerManager(), renderer: fakeRenderer(log, 'raster') }),
        state: (id, onAdded, v = 1) =>
            createRasterLayerState({
                id,
                source: RasterLayerSource.UrlTemplate({ template: `/${v}/{z}/{x}/{y}.png`, tileSize: 256 }),
                onAdded,
            }),
        change: (s) => { s.opacity = 0.3; },
    },
];

for (const kind of kinds) {
    test(`${kind.name}: 追加で 1 回、変更では呼ばず、remove → add で再び、clear では呼ばない`, async () => {
        const log = [];
        const controller = kind.make(log);
        const onAdded = (state) => log.push(`onAdded:${state.id}`);
        const a = kind.state('a', onAdded);
        await controller.composition([a, kind.state('b', onAdded)]);
        assert.equal(log[0].endsWith('.onAdd:a,b'), true, String(log));
        assert.deepEqual(log.slice(1), ['onAdded:a', 'onAdded:b']);

        log.length = 0;
        kind.change(a);
        await controller.update(a);
        await controller.composition([kind.state('a', onAdded, 2), kind.state('b', onAdded)]);
        assert.equal(log.filter((l) => l.startsWith('onAdded')).length, 0, String(log));

        await controller.composition([kind.state('b', onAdded)]);
        await controller.composition([a, kind.state('b', onAdded)]);
        await controller.clear();
        assert.deepEqual(log.filter((l) => l.startsWith('onAdded')), ['onAdded:a']);
    });

    test(`${kind.name}: onAdded が例外を投げても他は追加される`, async () => {
        const quiet = quietErrors();
        try {
            const log = [];
            const controller = kind.make(log);
            await controller.composition([
                kind.state('a', () => { throw new Error('boom'); }),
                kind.state('b', (state) => log.push(`onAdded:${state.id}`)),
            ]);
            assert.deepEqual(log.slice(1), ['onAdded:b']);
            assert.equal(controller.hasId('a'), true);
            assert.equal(quiet.errors.length, 1);
        } finally {
            quiet.restore();
        }
    });
}

test('ラスター: upsert（タイル用の内部レイヤ）も新規なら 1 回、更新では呼ばない', async () => {
    const log = [];
    const controller = kinds[3].make(log);
    const onAdded = (state) => log.push(`onAdded:${state.id}`);
    await controller.upsert(kinds[3].state('t', onAdded, 1));
    await controller.upsert(kinds[3].state('t', onAdded, 2));
    assert.deepEqual(log.filter((l) => l.startsWith('onAdded')), ['onAdded:t']);
    await controller.removeById('t');
    await controller.upsert(kinds[3].state('t', onAdded, 3));
    assert.deepEqual(log.filter((l) => l.startsWith('onAdded')), ['onAdded:t', 'onAdded:t']);
});
