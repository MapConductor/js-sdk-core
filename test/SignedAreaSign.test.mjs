// computeSignedArea の符号の約束: 北が上の地図で時計回りのリングが正、反時計回りが負。
// android-sdk の `SignedAreaSignTest`、ios-sdk の `SignedAreaSignTests` と同じ観点を見る。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Spherical, WGS84Geodesic } from '../dist/index.mjs';

const sw = { latitude: 35.0, longitude: 139.0 };
const se = { latitude: 35.0, longitude: 140.0 };
const ne = { latitude: 36.0, longitude: 140.0 };
const nw = { latitude: 36.0, longitude: 139.0 };
const clockwise = [sw, nw, ne, se];
const counterClockwise = [sw, se, ne, nw];

for (const [name, ns] of [['Spherical', Spherical], ['WGS84Geodesic', WGS84Geodesic]]) {
  test(`${name}: clockwise ring is positive`, () => {
    assert.ok(ns.computeSignedArea(clockwise) > 0);
  });

  test(`${name}: counter-clockwise ring is negative with the same magnitude`, () => {
    const cw = ns.computeSignedArea(clockwise);
    const ccw = ns.computeSignedArea(counterClockwise);
    assert.ok(ccw < 0);
    assert.ok(Math.abs(cw + ccw) < 1e-3);
    assert.ok(Math.abs(ns.computeArea(counterClockwise) - cw) < 1e-3);
  });
}
