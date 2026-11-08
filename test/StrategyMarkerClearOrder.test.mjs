import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    MarkerManager,
    StrategyMarkerController,
    createGeoPoint,
    createGeoRectBounds,
    createMarkerEntity,
    createMarkerState,
} from '../dist/index.mjs';

/**
 * StrategyMarkerController.clear() must leave nothing drawn, like the other controllers'
 * clear() (OverlayClearOrder.test.mjs): onRemove(everything) → empty the manager →
 * onPostProcess. It used to call onRemove and empty the manager but never onPostProcess,
 * so a GL renderer, which redraws from the manager in onPostProcess, kept showing the
 * markers. Same test on android-sdk-core and ios-sdk-core.
 */

const bounds = createGeoRectBounds({
    southWest: createGeoPoint({ latitude: 34, longitude: 138 }),
    northEast: createGeoPoint({ latitude: 36, longitude: 140 }),
});
const camera = { position: createGeoPoint({ latitude: 35, longitude: 139 }), zoom: 10, visibleRegion: { bounds } };

/** GL-style renderer: onRemove touches nothing, onPostProcess redraws the manager. */
class GlRenderer {
    constructor(manager) { this.manager = manager; this.drawn = []; this.removed = []; this.holder = null; }
    async onAdd(data) { return data.map((p) => p.state.id); }
    async onChange(data) { return data.map((p) => p.current.state.id); }
    async onRemove(data) { this.removed.push(...data.map((e) => e.state.id)); }
    async onAnimate() {}
    async onPostProcess() { this.drawn = this.manager.allEntities().map((e) => e.state.id).sort(); }
}

/** Draws every marker it is given, like the default strategies. */
class DrawAllStrategy {
    constructor() { this.markerManager = MarkerManager.defaultManager(); this.cleared = 0; }
    clear() { this.cleared++; this.markerManager.clear(); }
    async onAdd({ data, renderer }) {
        const markers = await renderer.onAdd(data.map((state) => ({ state, bitmapIcon: null })));
        data.forEach((state, i) => this.markerManager.registerEntity(createMarkerEntity({ state, marker: markers[i] })));
        await renderer.onPostProcess();
        return true;
    }
    async onUpdate() { return true; }
    async onCameraChanged() {}
}

function fixture() {
    const strategy = new DrawAllStrategy();
    const renderer = new GlRenderer(strategy.markerManager);
    const controller = new StrategyMarkerController({ strategy, renderer });
    return { strategy, renderer, controller };
}

const markers = () => [
    createMarkerState({ id: 'm1', position: createGeoPoint({ latitude: 35, longitude: 139 }) }),
    createMarkerState({ id: 'm2', position: createGeoPoint({ latitude: 35.1, longitude: 139.1 }) }),
];

test('clear() removes, empties the strategy, then post-processes, so nothing stays drawn', async () => {
    const f = fixture();
    await f.controller.onCameraChanged(camera);
    await f.controller.add(markers());
    assert.deepEqual(f.renderer.drawn, ['m1', 'm2']);

    await f.controller.clear();
    assert.deepEqual(f.renderer.removed.sort(), ['m1', 'm2'], 'onRemove gets every entity');
    assert.equal(f.strategy.cleared, 1, "the strategy's own clear() still runs");
    assert.deepEqual(f.renderer.drawn, [], 'nothing is drawn after clear()');
});

test('clear() drops markers still waiting for the first camera', async () => {
    const f = fixture();
    await f.controller.add(markers()); // no camera yet: queued
    await f.controller.clear();
    await f.controller.onCameraChanged(camera);
    assert.deepEqual(f.renderer.drawn, [], 'the queued markers must not appear after clear()');
});

test('markers sent again after clear() are drawn again', async () => {
    const f = fixture();
    await f.controller.onCameraChanged(camera);
    await f.controller.add(markers());
    await f.controller.clear();
    await f.controller.add(markers());
    assert.deepEqual(f.renderer.drawn, ['m1', 'm2']);
});
