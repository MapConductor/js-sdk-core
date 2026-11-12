// MapCameraPosition.paddings を地図エンジンに持たない SDK 向けのエミュレーション
// （paddedCameraCenter / paddedCameraTarget）と、MapCameraPosition.fov の扱い。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    computeDistanceBetween,
    computeHeading,
    createMapCameraPosition,
    paddedCameraCenter,
    paddedCameraTarget,
} from '../dist/index.mjs';

const tokyo = { latitude: 35.6812, longitude: 139.7671 };
const viewport = { width: 800, height: 600 };
const mppAt = (latitude, zoom) => (156_543.033_928 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
const top300 = { top: 300, left: 0, bottom: 0, right: 0 };

test('tilt 0: the center is the target shifted by the padding in pixels', () => {
    const center = paddedCameraCenter(tokyo, { zoom: 15, tilt: 0, bearing: 0, paddings: top300, fov: 36.87, viewport });
    // Top padding 300 → the padded center is 150 px below the screen center, so the
    // camera center is 150 px north of the target.
    const expected = 150 * mppAt(tokyo.latitude, 15);
    assert.ok(Math.abs(computeDistanceBetween(tokyo, center) - expected) < 0.01);
    assert.ok(Math.abs(computeHeading(tokyo, center)) < 1e-6);
});

test('no padding leaves the target as the center', () => {
    const center = paddedCameraCenter(tokyo, { zoom: 15, tilt: 60, bearing: 20, paddings: null, fov: 36.87, viewport });
    assert.ok(computeDistanceBetween(tokyo, center) < 1e-6);
});

test('round trip: target → center → target at any tilt, bearing and fov', () => {
    const paddings = { top: 240, left: 80, bottom: 20, right: 10 };
    for (const fov of [36.87, 25, 0, null]) {
        for (const tilt of [0, 30, 60]) {
            for (const bearing of [0, 45, -120]) {
                const params = { zoom: 14, tilt, bearing, paddings, fov, viewport };
                const center = paddedCameraCenter(tokyo, params);
                const back = paddedCameraTarget(center, params);
                assert.ok(computeDistanceBetween(back, tokyo) < 0.5, `fov=${fov} tilt=${tilt} bearing=${bearing}`);
            }
        }
    }
});

test('perspective: the target projects to the padded center through a pinhole camera', () => {
    const fov = 36.87;
    const tilt = 60;
    const zoom = 15;
    const paddings = { top: 300, left: 100, bottom: 0, right: 0 };
    const center = paddedCameraCenter(tokyo, { zoom, tilt, bearing: 0, paddings, fov, viewport });
    // Independent pinhole projection (bearing 0: forward = north, right = east).
    const f = viewport.height / 2 / Math.tan((fov * Math.PI) / 360);
    const mpp = mppAt(tokyo.latitude, zoom);
    const t = (tilt * Math.PI) / 180;
    const north = (tokyo.latitude - center.latitude) * 111_319.49;
    const east = (tokyo.longitude - center.longitude) * 111_319.49 * Math.cos((tokyo.latitude * Math.PI) / 180);
    const D = f * mpp;
    // Camera space: z along the optical axis, y screen-down, x screen-right.
    const z = D + north * Math.sin(t);
    const yDown = -north * Math.cos(t);
    const x = (east * f) / z;
    const y = (yDown * f) / z;
    assert.ok(Math.abs(x - 50) < 0.5, `x=${x}`);
    assert.ok(Math.abs(y - 150) < 0.5, `y=${y}`);
});

test('orthographic tilt (fov 0) stretches the forward shift by 1/cos(tilt)', () => {
    const center = paddedCameraCenter(tokyo, { zoom: 15, tilt: 60, bearing: 0, paddings: top300, fov: 0, viewport });
    const expected = (150 * mppAt(tokyo.latitude, 15)) / Math.cos(Math.PI / 3);
    assert.ok(Math.abs(computeDistanceBetween(tokyo, center) - expected) < 0.05);
});

test('perspective and orthographic differ; an unknown fov falls back to the flat shift', () => {
    const base = { zoom: 15, tilt: 60, bearing: 0, paddings: top300, viewport };
    const persp = computeDistanceBetween(tokyo, paddedCameraCenter(tokyo, { ...base, fov: 36.87 }));
    const ortho = computeDistanceBetween(tokyo, paddedCameraCenter(tokyo, { ...base, fov: 0 }));
    const unknown = computeDistanceBetween(tokyo, paddedCameraCenter(tokyo, { ...base, fov: null }));
    assert.ok(Math.abs(persp - ortho) > 1);
    assert.ok(Math.abs(unknown - 150 * mppAt(tokyo.latitude, 15)) < 0.01);
});

test('bearing rotates the shift with the camera heading', () => {
    // bearing -90 → camera faces east; the center moves east of the target.
    const center = paddedCameraCenter(tokyo, { zoom: 15, tilt: 0, bearing: -90, paddings: top300, fov: null, viewport });
    assert.ok(Math.abs(computeHeading(tokyo, center) - 90) < 1e-3);
});

test('fov: unset by default, kept by copy, not part of equals, cleared by an explicit null', () => {
    const camera = createMapCameraPosition({ position: tokyo, zoom: 12 });
    assert.equal(camera.fov, null);
    const withFov = camera.copy({ fov: 36.87 });
    assert.equal(withFov.fov, 36.87);
    assert.equal(withFov.copy({ zoom: 13 }).fov, 36.87);
    assert.equal(withFov.copy({ fov: null }).fov, null);
    assert.ok(withFov.equals(camera));
    assert.equal(createMapCameraPosition({ position: tokyo }).resolvedOnto(withFov).fov, null);
});
