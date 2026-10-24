import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { applyStyleMutations, parseStyleMutations } from '../dist/index.mjs';

/**
 * The body of every MapLibre-family provider's mutation support, against a
 * map that only records.
 *
 * MapLibre GL JS, Mapbox GL JS and the MapTiler SDK expose these methods
 * under the same names, so one applier serves all three — and checking it
 * here checks all three.
 */
describe('applyStyleMutations', () => {
    let map;
    let calls;

    beforeEach(() => {
        calls = [];
        const layers = new Set(['roads', 'labels']);
        map = {
            styleLoaded: true,
            isStyleLoaded: () => map.styleLoaded,
            getLayer: (id) => (layers.has(id) ? { id } : undefined),
            setPaintProperty: (...args) => calls.push(['paint', ...args]),
            setLayoutProperty: (...args) => calls.push(['layout', ...args]),
            setFilter: (...args) => calls.push(['filter', ...args]),
            setLayerZoomRange: (...args) => calls.push(['zoom', ...args]),
            addLayer: (layer, beforeId) => {
                layers.add(layer.id);
                calls.push(['add', layer, beforeId]);
            },
            removeLayer: (id) => {
                layers.delete(id);
                calls.push(['remove', id]);
            },
        };
    });

    const mutations = (json) => parseStyleMutations(JSON.stringify(json));

    test('sets paint and layout properties as parsed values', () => {
        const unapplied = applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'roads', key: 'line-color', value: '#fff', previous: '#888' },
                {
                    op: 'setPaint',
                    layerId: 'roads',
                    key: 'line-width',
                    value: ['*', 2, 1.3],
                    previous: 2,
                },
                { op: 'setLayout', layerId: 'labels', key: 'visibility', value: 'none', previous: null },
            ]),
        );

        assert.deepEqual(unapplied, []);
        assert.deepEqual(calls, [
            ['paint', 'roads', 'line-color', '#fff'],
            ['paint', 'roads', 'line-width', ['*', 2, 1.3]],
            ['layout', 'labels', 'visibility', 'none'],
        ]);
    });

    // A property with no value goes back to the spec default, which GL-JS
    // spells `undefined`. `null` would be read as a value.
    test('a null value clears the property', () => {
        applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'roads', key: 'line-color', value: null, previous: '#888' },
                { op: 'setFilter', layerId: 'roads', value: null, previous: ['all'] },
            ]),
        );
        assert.deepEqual(calls[0], ['paint', 'roads', 'line-color', null]);
        assert.deepEqual(calls[1], ['filter', 'roads', undefined]);
    });

    // GL-JS takes both ends at once, so changing one has to restate the
    // other -- and a layer that named neither gets the spec's own defaults.
    test('a zoom range restates both ends', () => {
        applyStyleMutations(
            map,
            mutations([
                {
                    op: 'setZoomRange',
                    layerId: 'roads',
                    minZoom: 5,
                    maxZoom: null,
                    previousMinZoom: null,
                    previousMaxZoom: null,
                },
            ]),
        );
        assert.deepEqual(calls, [['zoom', 'roads', 5, 24]]);
    });

    /**
     * A layer the style does not have is not a crash and not a silent pass:
     * it comes back, and the caller says so.
     */
    test('what the style has no layer for comes back', () => {
        const unapplied = applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'roads', key: 'line-color', value: '#fff', previous: null },
                { op: 'setPaint', layerId: 'nope', key: 'line-color', value: '#fff', previous: null },
            ]),
        );
        assert.equal(unapplied.length, 1);
        assert.equal(unapplied[0].layerId, 'nope');
        assert.equal(calls.length, 1, 'the good one still went through');
    });

    /** One property the renderer rejects must not cost the other three hundred. */
    test('a throwing property is reported, not propagated', () => {
        map.setPaintProperty = () => {
            throw new Error('nope');
        };
        const unapplied = applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'roads', key: 'line-color', value: '#fff', previous: null },
                { op: 'setLayout', layerId: 'labels', key: 'visibility', value: 'none', previous: null },
            ]),
        );
        assert.equal(unapplied.length, 1);
        assert.deepEqual(calls, [['layout', 'labels', 'visibility', 'none']]);
    });

    test('adds and removes a layer', () => {
        const added = { id: 'mapconductor-background', type: 'background' };
        applyStyleMutations(
            map,
            mutations([
                { op: 'addLayer', layerId: added.id, layer: added, beforeId: 'roads' },
            ]),
        );
        assert.deepEqual(calls, [['add', added, 'roads']]);

        calls = [];
        applyStyleMutations(
            map,
            mutations([{ op: 'removeLayer', layerId: 'mapconductor-background' }]),
        );
        assert.deepEqual(calls, [['remove', 'mapconductor-background']]);
    });

    /**
     * Putting the whole set back after a style reload must not throw on the
     * layer that is already there — which is what GL-JS does for a duplicate
     * id.
     */
    test('adding a layer that is already there is a no-op, not a throw', () => {
        const added = { id: 'roads', type: 'background' };
        const unapplied = applyStyleMutations(
            map,
            mutations([{ op: 'addLayer', layerId: added.id, layer: added }]),
        );
        assert.deepEqual(unapplied, []);
        assert.deepEqual(calls, []);
    });

    test('removing a layer that is already gone is a no-op', () => {
        const unapplied = applyStyleMutations(map, mutations([{ op: 'removeLayer', layerId: 'gone' }]));
        assert.deepEqual(unapplied, []);
        assert.deepEqual(calls, []);
    });

    /**
     * No style yet is "not done" rather than "cannot be done".
     *
     * Conflating the two is what told an app "N adjustments were not
     * applied: this map cannot set those properties" about a map that was
     * merely still loading — and under the reloading policy it then handed
     * the map the adjusted document, which is the reload this design exists
     * to avoid. Nothing is lost by waiting: the store puts the whole set
     * back when the style loads.
     */
    test('nothing is reported while there is no style', () => {
        map.styleLoaded = false;

        const unapplied = applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'roads', key: 'line-color', value: '#fff', previous: null },
                { op: 'setPaint', layerId: 'nope', key: 'line-color', value: '#fff', previous: null },
            ]),
        );

        assert.deepEqual(unapplied, []);
        assert.deepEqual(calls, [], 'not even attempted');
    });

    /** Once it is ready, the judgement comes back exactly as before. */
    test('the judgement comes back once ready', () => {
        const paint = mutations([
            { op: 'setPaint', layerId: 'nope', key: 'line-color', value: '#fff', previous: null },
        ]);

        map.styleLoaded = false;
        assert.deepEqual(applyStyleMutations(map, paint), []);

        map.styleLoaded = true;
        assert.equal(applyStyleMutations(map, paint).length, 1);
    });

    /**
     * MapLibre answers nothing at all before the style object exists, which
     * is the very case this guard is for. A check written as
     * `isStyleLoaded() === false` passes every other test here and misses
     * this one.
     */
    test('an answer of undefined counts as not ready', () => {
        map.isStyleLoaded = () => undefined;
        const unapplied = applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'roads', key: 'line-color', value: '#fff', previous: null },
            ]),
        );
        assert.deepEqual(unapplied, []);
        assert.deepEqual(calls, [], 'not even attempted');
    });

    /**
     * A map without the call at all is taken to be ready — which is what
     * every map was before this existed.
     */
    test('a map with no isStyleLoaded is taken to be ready', () => {
        delete map.isStyleLoaded;
        const unapplied = applyStyleMutations(
            map,
            mutations([
                { op: 'setPaint', layerId: 'nope', key: 'line-color', value: '#fff', previous: null },
            ]),
        );
        assert.equal(unapplied.length, 1);
    });
});
