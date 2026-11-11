// マーカーの重なり順。zIndex（未指定は 0）が先、同じなら南が手前、緯度も同じなら西が手前。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGeoPoint, markerDrawOrder } from '../dist/index.mjs';

const at = (latitude, longitude) => createGeoPoint({ latitude, longitude });

describe('markerDrawOrder', () => {
    it('puts a larger zIndex in front wherever the markers are', () => {
        assert.ok(markerDrawOrder(1, at(35.7, 139.8)) > markerDrawOrder(null, at(-89.9, -179.9)));
        assert.ok(markerDrawOrder(0, at(-89.9, -179.9)) < markerDrawOrder(1, at(89.9, 179.9)));
        assert.ok(markerDrawOrder(-1, at(-89.9, 0)) < markerDrawOrder(null, at(89.9, 0)));
    });

    it('treats a null zIndex as 0', () => {
        assert.equal(markerDrawOrder(null, at(35, 139)), markerDrawOrder(0, at(35, 139)));
        assert.equal(markerDrawOrder(undefined, at(35, 139)), markerDrawOrder(0, at(35, 139)));
    });

    it('puts an explicit zIndex 1 above null markers in the southern hemisphere', () => {
        // The old automatic order (-latitude * 1e6) made this one a large positive number.
        assert.ok(markerDrawOrder(1, at(-33.87, 151.21)) > markerDrawOrder(null, at(-33.87, 151.21)));
        assert.ok(markerDrawOrder(1, at(-33.87, 151.21)) > markerDrawOrder(null, at(-45, 170)));
    });

    it('puts the southern one in front on a tie', () => {
        assert.ok(markerDrawOrder(null, at(35.0, 139.0)) > markerDrawOrder(null, at(35.001, 139.0)));
        assert.ok(markerDrawOrder(2, at(-10, 0)) > markerDrawOrder(2, at(10, 0)));
    });

    it('puts the western one in front on the same latitude', () => {
        assert.ok(markerDrawOrder(null, at(35, 139.0)) > markerDrawOrder(null, at(35, 139.001)));
    });

    it('keeps the position share below half a zIndex step', () => {
        for (const p of [at(-90, -180), at(90, 180), at(0, 0), at(-90, 179.999)]) {
            const order = markerDrawOrder(5, p);
            assert.ok(order >= 5 && order < 5.5, `${order}`);
        }
    });
});
