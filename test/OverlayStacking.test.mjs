import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    OVERLAY_STACK_ORDER,
    compareOverlayStackKeys,
    overlayStackBand,
    overlayStackBeforeId,
    overlayStackZ,
} from '../dist/index.mjs';

/**
 * The overlay stack, bottom to top, on every provider (user decision, 2026-11-07):
 * raster < groundImage < polygon < circle < polyline < marker. zIndex orders within a band;
 * equal zIndexes keep the order they were handed over in. Same order on android-sdk-core and
 * ios-sdk-core.
 */

test('the band order', () => {
    assert.deepEqual([...OVERLAY_STACK_ORDER], ['rasterLayer', 'groundImage', 'polygon', 'circle', 'polyline', 'marker']);
    assert.ok(overlayStackBand('rasterLayer') < overlayStackBand('groundImage'));
    assert.ok(overlayStackBand('polygon') < overlayStackBand('circle'));
    assert.ok(overlayStackBand('circle') < overlayStackBand('polyline'));
});

test('band beats zIndex; zIndex beats the order handed over; then sub', () => {
    assert.ok(compareOverlayStackKeys({ kind: 'polygon', zIndex: 1000 }, { kind: 'circle', zIndex: -1000 }) < 0);
    assert.ok(compareOverlayStackKeys({ kind: 'polygon', zIndex: 2, sequence: 1 }, { kind: 'polygon', zIndex: 1, sequence: 9 }) > 0);
    assert.ok(compareOverlayStackKeys({ kind: 'polygon', sequence: 1, sub: 1 }, { kind: 'polygon', sequence: 2, sub: 0 }) < 0);
    assert.equal(compareOverlayStackKeys({ kind: 'marker' }, { kind: 'marker', zIndex: 0, sequence: 0, sub: 0 }), 0);
});

/** A layer stack like MapLibre GL's: addLayer(layer, beforeId). */
function glMap(basemap) {
    const order = [...basemap];
    return {
        order,
        add(id, beforeId) {
            const at = beforeId ? order.indexOf(beforeId) : -1;
            if (at >= 0) order.splice(at, 0, id); else order.push(id);
        },
    };
}

function* permutations(items) {
    if (items.length <= 1) { yield items; return; }
    for (let i = 0; i < items.length; i++) {
        for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
    }
}

const LAYERS = {
    raster: { kind: 'rasterLayer' },
    gimg: { kind: 'groundImage' },
    'polygon-fill': { kind: 'polygon', sub: 0 },
    'polygon-outline': { kind: 'polygon', sub: 1 },
    circle: { kind: 'circle' },
    polyline: { kind: 'polyline' },
    marker: { kind: 'marker' },
};
const BASEMAP = ['background', 'water', 'road', 'place-label'];

test('inserting with overlayStackBeforeId gives the same stack for every insertion order', () => {
    const want = [...BASEMAP, 'raster', 'gimg', 'polygon-fill', 'polygon-outline', 'circle', 'polyline', 'marker'];
    let n = 0;
    for (const perm of permutations(Object.keys(LAYERS))) {
        const map = glMap(BASEMAP);
        for (const id of perm) map.add(id, overlayStackBeforeId(map.order, (x) => LAYERS[x] ?? null, LAYERS[id]));
        assert.deepEqual(map.order, want, perm.join(','));
        n++;
    }
    assert.equal(n, 5040);
});

test('within a band: zIndex first, then the order handed over', () => {
    const map = glMap(BASEMAP);
    const keys = {
        a: { kind: 'groundImage', zIndex: 0, sequence: 1 },
        b: { kind: 'groundImage', zIndex: 0, sequence: 2 },
        c: { kind: 'groundImage', zIndex: -1, sequence: 3 },
        p: { kind: 'polygon' },
    };
    for (const id of ['p', 'b', 'c', 'a']) map.add(id, overlayStackBeforeId(map.order, (x) => keys[x] ?? null, keys[id]));
    assert.deepEqual(map.order.slice(BASEMAP.length), ['c', 'a', 'b', 'p']);
});

test('layers that are not ours are skipped', () => {
    // Something an extension appended on top must not stop a polygon from going under our circle.
    const order = [...BASEMAP, 'circle', 'geojson-ext'];
    assert.equal(overlayStackBeforeId(order, (x) => LAYERS[x] ?? null, LAYERS['polygon-fill']), 'circle');
    assert.equal(overlayStackBeforeId(order, (x) => LAYERS[x] ?? null, LAYERS.marker), undefined);
});

test('overlayStackZ keeps the bands apart whatever the zIndex', () => {
    for (let i = 0; i + 1 < OVERLAY_STACK_ORDER.length; i++) {
        const lowTop = overlayStackZ(OVERLAY_STACK_ORDER[i], 1e9);
        const highBottom = overlayStackZ(OVERLAY_STACK_ORDER[i + 1], -1e9);
        assert.ok(lowTop < highBottom, `${OVERLAY_STACK_ORDER[i]} ${lowTop} vs ${OVERLAY_STACK_ORDER[i + 1]} ${highBottom}`);
    }
    assert.ok(overlayStackZ('polygon', 1) > overlayStackZ('polygon', 0));
    assert.equal(overlayStackZ('rasterLayer', 0, { base: 100, bandSize: 20 }), 100);
    assert.equal(overlayStackZ('marker', 0, { base: 100, bandSize: 20 }), 200);
    assert.equal(overlayStackZ('marker', 50, { base: 100, bandSize: 20 }), 209);
});

test('the polyline tiles (sub -1) are over the circles, under the native polylines and the markers', () => {
    const order = ['polygon-tiles', 'polygon', 'circle', 'polyline', 'marker'];
    const keys = {
        'polygon-tiles': { kind: 'polygon', sub: -1 },
        polygon: { kind: 'polygon', sub: 0 },
        circle: { kind: 'circle' },
        polyline: { kind: 'polyline', sub: 0 },
        marker: { kind: 'marker' },
        'polyline-tiles': { kind: 'polyline', sub: -1 },
    };
    const map = glMap(BASEMAP);
    for (const id of order) map.add(id, overlayStackBeforeId(map.order, (x) => keys[x] ?? null, keys[id]));
    map.add('polyline-tiles', overlayStackBeforeId(map.order, (x) => keys[x] ?? null, keys['polyline-tiles']));
    assert.deepEqual(map.order.slice(BASEMAP.length), ['polygon-tiles', 'polygon', 'circle', 'polyline-tiles', 'polyline', 'marker']);
});
