import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
    parseStyleMutations,
    reverseStyleMutation,
    styleMutationLayerId,
    styleMutationTarget,
    StyleMutationStore,
} from '../dist/index.mjs';

/**
 * The two things a provider would otherwise have to remember on its own, and
 * both of which look fine until they do not: a replaced set has to undo what
 * it dropped, and a style load wipes everything that was applied.
 *
 * android-sdk の `StyleMutationStoreTest`、ios-sdk の
 * `StyleMutationStoreTests` と 1 対 1 で対応する。
 */
describe('StyleMutationStore', () => {
    let applied = [];
    beforeEach(() => {
        applied = [];
    });

    const store = (unsupported = () => false) =>
        new StyleMutationStore((mutations) => {
            applied.push(...mutations);
            return mutations.filter(unsupported);
        });

    const paint = (layerId, key, value, previous) => ({
        op: 'setPaint',
        layerId,
        key,
        value,
        previous,
    });

    test('replacing a set puts back what the new one no longer mentions', () => {
        const subject = store();
        subject.apply([
            paint('roads', 'line-color', '"#fff"', '"#888"'),
            paint('water', 'fill-color', '"#000"', '"#a0c8f0"'),
        ]);
        applied = [];

        // The second set drops the water rule entirely.
        subject.apply([paint('roads', 'line-color', '"#f00"', '"#888"')]);

        assert.deepEqual(applied, [
            paint('water', 'fill-color', '"#a0c8f0"', '"#000"'),
            paint('roads', 'line-color', '"#f00"', '"#888"'),
        ]);
    });

    // The restore has to be sent before the new value, or a property that
    // both sets touch would be put back to the style's value after being
    // given its new one.
    test('restores go out before the new values', () => {
        const subject = store();
        subject.apply([paint('a', 'line-color', '"#1"', '"#0"')]);
        applied = [];
        subject.apply([paint('b', 'line-color', '"#2"', '"#0"')]);

        assert.equal(applied[0].layerId, 'a');
        assert.equal(applied[applied.length - 1].layerId, 'b');
    });

    test('clear puts everything back', () => {
        const subject = store();
        subject.apply([paint('roads', 'line-color', '"#fff"', '"#888"')]);
        applied = [];

        subject.clear();

        assert.deepEqual(applied, [paint('roads', 'line-color', '"#888"', '"#fff"')]);
        assert.equal(subject.applied.length, 0);
    });

    // A design change, a provider reloading, anything: the renderer comes
    // back with the document's values and nothing that was applied over
    // them. Without this the adjustment survives until the first basemap
    // switch and then quietly stops.
    test('a style load puts the whole set on again', () => {
        const subject = store();
        const mutations = [paint('roads', 'line-color', '"#fff"', '"#888"')];
        subject.apply(mutations);
        applied = [];

        subject.onStyleLoaded();

        assert.deepEqual(applied, mutations);
    });

    test('nothing applied means nothing to do on a style load', () => {
        store().onStyleLoaded();
        assert.equal(applied.length, 0);
    });

    // MapLibre on iOS cannot set every spec key by name. The caller has to
    // be told which ones, rather than being left to assume the map looks the
    // way the rules asked.
    test('what the map could not do comes back', () => {
        const subject = store((m) => m.key === 'line-gradient');
        const failed = subject.apply([
            paint('roads', 'line-color', '"#fff"', '"#888"'),
            paint('roads', 'line-gradient', '["interpolate"]', 'null'),
        ]);
        assert.equal(failed.length, 1);
        assert.equal(failed[0].key, 'line-gradient');
    });
});

describe('StyleMutation', () => {
    test('reads what the compiler writes', () => {
        const parsed = parseStyleMutations(`[
            {"op":"setPaint","layerId":"roads","key":"line-color","value":"#fff","previous":null},
            {"op":"setLayout","layerId":"labels","key":"visibility","value":"none","previous":"visible"},
            {"op":"setFilter","layerId":"roads","value":["==","class","motorway"],"previous":null},
            {"op":"setZoomRange","layerId":"roads","minZoom":5,"maxZoom":null,
             "previousMinZoom":null,"previousMaxZoom":null},
            {"op":"addLayer","layerId":"bg","layer":{"id":"bg","type":"background"},"beforeId":"water"},
            {"op":"somethingFromTheFuture","layerId":"roads"}
        ]`);

        assert.equal(parsed.length, 5, 'the unknown op is dropped, the rest survive');
        // A string value keeps its quotes, or no renderer could read it back.
        assert.equal(parsed[0].value, '"#fff"');
        assert.equal(parsed[0].previous, 'null');
        assert.equal(parsed[2].value, '["==","class","motorway"]');
        assert.equal(parsed[3].minZoom, 5);
        assert.equal(parsed[3].maxZoom, null);
        assert.equal(styleMutationLayerId(parsed[4]), 'bg');
        assert.equal(parsed[4].beforeId, 'water');
    });

    // Rubbish in must not take the map down; it means no adjustment.
    test('answers with nothing rather than throwing', () => {
        assert.deepEqual(parseStyleMutations('not json'), []);
        assert.deepEqual(parseStyleMutations('{}'), []);
        assert.deepEqual(parseStyleMutations('[{"op":"setPaint"}]'), []);
    });

    // Applying a set and then its reverse has to leave the map where it
    // started, whatever the values were.
    test('every mutation undoes itself', () => {
        const mutations = parseStyleMutations(`[
            {"op":"setPaint","layerId":"a","key":"line-color","value":"#fff","previous":"#888"},
            {"op":"setLayout","layerId":"b","key":"visibility","value":"none","previous":null},
            {"op":"setFilter","layerId":"c","value":["all"],"previous":null},
            {"op":"setZoomRange","layerId":"d","minZoom":5,"maxZoom":12,
             "previousMinZoom":null,"previousMaxZoom":22}
        ]`);
        for (const mutation of mutations) {
            assert.deepEqual(
                reverseStyleMutation(reverseStyleMutation(mutation)),
                mutation,
                `${styleMutationTarget(mutation)} did not survive a round trip`,
            );
        }
    });

    test('adding a layer is undone by removing it', () => {
        const add = {
            op: 'addLayer',
            layerId: 'bg',
            layer: '{"id":"bg","type":"background"}',
            beforeId: null,
        };
        assert.deepEqual(reverseStyleMutation(add), { op: 'removeLayer', layerId: 'bg' });
    });
});
