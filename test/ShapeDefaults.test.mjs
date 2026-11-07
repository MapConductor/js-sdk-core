// 図形・地表画像の既定値。コンポーネント形（js-sdk-react の <Circle> など）と
// state 形（create*State）で同じ値になるよう 3 プラットフォームで揃えている:
// Circle / Polygon / Polyline の strokeWidth = 1、GroundImage の opacity = 1.0。
// android-sdk の `ShapeDefaultsTest`、ios-sdk の `ShapeDefaultsTests` と同じ観点。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCircleState,
  createPolygonState,
  createPolylineState,
  createGroundImageState,
  createGeoRectBounds,
  createGeoPoint,
} from '../dist/index.mjs';

const a = createGeoPoint({ latitude: 35.0, longitude: 139.0 });
const b = createGeoPoint({ latitude: 35.0, longitude: 140.0 });
const c = createGeoPoint({ latitude: 36.0, longitude: 140.0 });

test('CircleState strokeWidth defaults to 1', () => {
  assert.equal(createCircleState({ center: a, radiusMeters: 100 }).strokeWidth, 1);
});

test('PolygonState strokeWidth defaults to 1', () => {
  assert.equal(createPolygonState({ points: [a, b, c] }).strokeWidth, 1);
});

test('PolylineState strokeWidth defaults to 1', () => {
  assert.equal(createPolylineState({ points: [a, b] }).strokeWidth, 1);
});

test('GroundImageState opacity defaults to 1.0', () => {
  const bounds = createGeoRectBounds({ southWest: a, northEast: c });
  assert.equal(
    createGroundImageState({ bounds, imageUrl: 'https://example.com/a.png' }).opacity,
    1.0,
  );
});
