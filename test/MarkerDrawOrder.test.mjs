// マーカーの重なり順。zIndex（未指定は 0）が先、同じなら回転後の画面で下が手前、同じ行なら左が手前。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGeoPoint, markerDrawOrder, MarkerDrawOrderView } from '../dist/index.mjs';

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

    describe('rotated map (matches what Google Maps JS was measured to do)', () => {
        const order = (z, lat, lng, bearing, origin = 139) => markerDrawOrder(z, at(lat, lng), bearing, origin);

        it('puts the southern one in front at bearing 0, the same as the 2-argument form', () => {
            assert.ok(order(null, 35.0, 139, 0) > order(null, 35.01, 139, 0));
            assert.ok(order(null, 35, 139.0, 0) > order(null, 35, 139.01, 0));
            assert.equal(markerDrawOrder(null, at(35, 139)), markerDrawOrder(null, at(35, 139), 0, 0));
        });

        it('puts the western one in front at bearing 90 (facing east, west is down on screen)', () => {
            assert.ok(order(null, 35, 139.0, 90) > order(null, 35, 139.01, 90));
        });

        it('puts the northern one in front on the same screen row at bearing 90 (north is left)', () => {
            assert.ok(order(null, 35.01, 139, 90) > order(null, 35.0, 139, 90));
        });

        it('puts the northern one in front at bearing 180', () => {
            assert.ok(order(null, 35.01, 139, 180) > order(null, 35.0, 139, 180));
            // Same row: east is on the left.
            assert.ok(order(null, 35, 139.01, 180) > order(null, 35, 139.0, 180));
        });

        it('puts the eastern one in front at bearing 270 (facing west, east is down on screen)', () => {
            assert.ok(order(null, 35, 139.01, 270) > order(null, 35, 139.0, 270));
            // Same row: south is on the left.
            assert.ok(order(null, 35.0, 139, 270) > order(null, 35.01, 139, 270));
        });

        it('keeps a larger zIndex in front at every bearing', () => {
            for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
                assert.ok(order(1, 35.01, 139, bearing) > order(null, 35.0, 139, bearing), `${bearing}`);
                assert.ok(order(1, 35.0, 139, bearing) > order(null, 35.01, 139, bearing), `${bearing}`);
                assert.ok(order(null, 35, 139, bearing) > order(-1, -80, -40, bearing), `${bearing}`);
            }
        });

        it('measures across the antimeridian the short way round', () => {
            // 179.99E is just west of 179.99W; at bearing 90 the western one is lower on screen.
            assert.ok(order(null, 0, 179.99, 90, 180) > order(null, 0, -179.99, 90, 180));
            assert.ok(order(null, 0, 179.99, 0, 180) > order(null, 0, -179.99, 0, 180));
        });

        it('keeps the position share below half a zIndex step at any bearing and origin', () => {
            for (const bearing of [0, 33, 90, 180, 271, 359.9]) {
                for (const origin of [-180, 0, 139, 180]) {
                    for (const p of [at(-90, -180), at(90, 180), at(0, 0), at(-90, 179.999), at(85, -100)]) {
                        const value = markerDrawOrder(5, p, bearing, origin);
                        assert.ok(value >= 5 && value < 5.5, `${value}`);
                    }
                }
            }
        });
    });

    describe('MarkerDrawOrderView', () => {
        it('asks for a re-sort only when the heading turns at least half a degree', () => {
            const view = new MarkerDrawOrderView();
            assert.equal(view.update(0, 10), false);
            assert.equal(view.update(0.3, 10), false);
            assert.equal(view.update(0.6, 10), true);
            assert.equal(view.update(0.6, 20), false);
            assert.equal(view.update(359.9, 20), true);
            assert.equal(view.heading, 359.9);
        });

        it('moves the origin when the camera pans far', () => {
            const view = new MarkerDrawOrderView();
            assert.equal(view.update(0, 179), true);
            assert.equal(view.originLongitude, 179);
            assert.equal(view.update(0, -179), false);
        });

        it('orders with the remembered heading', () => {
            const view = new MarkerDrawOrderView();
            view.update(180, 139);
            assert.ok(view.order(null, at(35.01, 139)) > view.order(null, at(35.0, 139)));
            assert.equal(view.order(2, at(35, 139)), markerDrawOrder(2, at(35, 139), 180, 139));
        });
    });
});
