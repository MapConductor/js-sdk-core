import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createRasterLayerState,
    RasterLayerController,
    RasterLayerManager,
    RasterLayerSource,
} from '../dist/index.mjs';

/**
 * resync() は add / update / clear と同じロックの中で動く。
 *
 * 変更は renderer.onChange() が終わってから manager に登録するまでの間に await を挟む。
 * そこへスタイルのイベントで resync() が入っても、貼り直すのは最新の状態でなければならない。
 * renderer は「最後に貼った状態」を覚えるだけの偽物で、地図の SDK は要らない。
 */

class Controller extends RasterLayerController {}

function state(version, opacity = 1) {
    return createRasterLayerState({
        id: 'tiles',
        opacity,
        source: RasterLayerSource.UrlTemplate({ template: `/${version}/{z}/{x}/{y}.png`, tileSize: 256 }),
    });
}

function fixture() {
    const drawn = new Map();
    const renderer = {
        async onAdd(data) {
            for (const { state } of data) drawn.set(state.id, state);
            return data.map(({ state }) => ({ id: state.id }));
        },
        async onChange(data) {
            for (const { current } of data) drawn.set(current.state.id, current.state);
            return data.map(({ prev }) => prev.layer);
        },
        async onRemove(data) {
            for (const entity of data) drawn.delete(entity.state.id);
        },
        async onCameraChanged() {},
        async onPostProcess() {},
    };
    const controller = new Controller({ rasterLayerManager: new RasterLayerManager(), renderer });
    return { renderer, controller, drawn: () => drawn.get('tiles') };
}

// renderer.onChange() が終わり、manager に登録される前に `onWindow` を走らせる。
function inChangeWindow(f, onWindow) {
    const onChange = f.renderer.onChange;
    let pending = Promise.resolve();
    f.renderer.onChange = async (data) => {
        const handles = await onChange(data);
        queueMicrotask(() => { pending = onWindow(); });
        f.renderer.onChange = onChange;
        return handles;
    };
    return () => pending;
}

for (const method of ['composition', 'update', 'upsert']) {
    test(`resync started during ${method} redraws the newer state`, async () => {
        const f = fixture();
        await f.controller.composition([state('circle')]);
        const resynced = inChangeWindow(f, () => f.controller.resync());
        const numbered = state('numbered', 0.5);
        await f.controller[method](method === 'composition' ? [numbered] : numbered);
        await resynced();
        assert.equal(f.controller.rasterLayerManager.getEntity('tiles').state, numbered);
        assert.equal(f.drawn(), numbered);
    });
}

test('resync started during clear does not redraw the removed layer', async () => {
    const f = fixture();
    await f.controller.composition([state('circle')]);
    const onRemove = f.renderer.onRemove;
    let resynced = Promise.resolve();
    f.renderer.onRemove = async (data) => {
        await onRemove(data);
        queueMicrotask(() => { resynced = f.controller.resync(); });
        f.renderer.onRemove = onRemove;
    };
    await f.controller.clear();
    await resynced;
    assert.equal(f.controller.rasterLayerManager.getEntity('tiles'), null);
    assert.equal(f.drawn(), undefined);
});

test('resync keeps the registered entities', async () => {
    const f = fixture();
    const circle = state('circle');
    await f.controller.composition([circle]);
    const entity = f.controller.rasterLayerManager.getEntity('tiles');
    await f.controller.resync();
    assert.equal(f.controller.rasterLayerManager.getEntity('tiles'), entity);
    assert.equal(f.drawn(), circle);
});
