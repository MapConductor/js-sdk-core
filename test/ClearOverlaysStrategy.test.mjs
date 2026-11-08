import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    BaseMapViewController,
    MapDriverConformance,
    MarkerManager,
    StrategyMarkerController,
    createGeoPoint,
    createGeoRectBounds,
    createMarkerEntity,
    createMarkerState,
} from '../dist/index.mjs';

/**
 * clearOverlays() must also clear the marker controllers that extensions register
 * (MarkerClusterGroup / MarkerRenderingSupport build a StrategyMarkerController and
 * registerOverlayController it). Providers used to clear only their own six
 * controllers, so clustered markers stayed on the map after clearOverlays().
 * Providers now call clearOverlayControllers(own) from clearOverlays().
 */

const bounds = createGeoRectBounds({
    southWest: createGeoPoint({ latitude: 34, longitude: 138 }),
    northEast: createGeoPoint({ latitude: 36, longitude: 140 }),
});
const camera = { position: createGeoPoint({ latitude: 35, longitude: 139 }), zoom: 10, visibleRegion: { bounds } };

class GlRenderer {
    constructor(manager) { this.manager = manager; this.drawn = []; this.holder = null; }
    async onAdd(data) { return data.map((p) => p.state.id); }
    async onChange(data) { return data.map((p) => p.current.state.id); }
    async onRemove() {}
    async onAnimate() {}
    async onPostProcess() { this.drawn = this.manager.allEntities().map((e) => e.state.id).sort(); }
}

class DrawAllStrategy {
    constructor() { this.markerManager = MarkerManager.defaultManager(); }
    clear() { this.markerManager.clear(); }
    async onAdd({ data, renderer }) {
        const markers = await renderer.onAdd(data.map((state) => ({ state, bitmapIcon: null })));
        data.forEach((state, i) => this.markerManager.registerEntity(createMarkerEntity({ state, marker: markers[i] })));
        await renderer.onPostProcess();
        return true;
    }
    async onUpdate() { return true; }
    async onCameraChanged() {}
}

/** A provider's own controller: counts clear() calls, in the order they happen. */
class OwnController {
    constructor(kind, log) { this.kind = kind; this.log = log; }
    hasId() { return false; }
    async compositionAny() {}
    async updateAny() {}
    setClickListenerAny() {}
    resolveTap() { return null; }
    async clear() { this.log.push(this.kind); }
}

class Provider extends BaseMapViewController {
    constructor() {
        super();
        this.log = [];
        this.own = ['marker', 'circle', 'polyline', 'polygon', 'groundImage', 'rasterLayer'].map((k) => new OwnController(k, this.log));
        this.own.forEach((c) => this.registerOverlayController(c));
    }
    async clearOverlays() { await this.clearOverlayControllers(this.own); }
}

/** The old shape: the provider clears its own controllers only. */
class OldProvider extends Provider {
    async clearOverlays() { for (const c of this.own) await c.clear(); }
}

async function strategyOn(provider) {
    const strategy = new DrawAllStrategy();
    const renderer = new GlRenderer(strategy.markerManager);
    const smc = new StrategyMarkerController({ strategy, renderer });
    provider.registerOverlayController(smc);
    await smc.onCameraChanged(camera);
    await smc.add([
        createMarkerState({ id: 's1', position: createGeoPoint({ latitude: 35, longitude: 139 }) }),
        createMarkerState({ id: 's2', position: createGeoPoint({ latitude: 35.1, longitude: 139.1 }) }),
    ]);
    return { strategy, renderer, smc };
}

test('clearOverlays() clears a registered StrategyMarkerController', async () => {
    const provider = new Provider();
    const { strategy, renderer } = await strategyOn(provider);
    assert.deepEqual(renderer.drawn, ['s1', 's2']);
    await provider.clearOverlays();
    assert.deepEqual(renderer.drawn, []);
    assert.equal(strategy.markerManager.allEntities().length, 0);
});

test('own controllers are cleared first, once each, in the order given', async () => {
    const provider = new Provider();
    await strategyOn(provider);
    await provider.clearOverlays();
    assert.deepEqual(provider.log, ['marker', 'circle', 'polyline', 'polygon', 'groundImage', 'rasterLayer']);
});

test('controllers that only listen to the camera are left alone', async () => {
    const provider = new Provider();
    let cleared = 0;
    // heatmap-style: registers for camera events, is not a slotted overlay controller
    provider.registerOverlayController({ onCameraChanged() {}, clear() { cleared++; } });
    await provider.clearOverlays();
    assert.equal(cleared, 0);
});

test('an unregistered strategy controller is not cleared', async () => {
    const provider = new Provider();
    const { renderer, smc } = await strategyOn(provider);
    provider.unregisterOverlayController(smc);
    await provider.clearOverlays();
    assert.deepEqual(renderer.drawn, ['s1', 's2']);
});

test('conformance check passes for clearOverlayControllers and fails for the old shape', async () => {
    await MapDriverConformance.checkClearOverlaysReachesExtensions(new Provider());
    await assert.rejects(
        MapDriverConformance.checkClearOverlaysReachesExtensions(new OldProvider()),
        /clearOverlays\(\) cleared a registered extension marker controller 0 times/,
    );
});
