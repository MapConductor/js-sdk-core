// 未指定の zoom / bearing / tilt だけが現在のカメラから引き継がれ、明示された 0 は
// そのまま使われること。android-sdk の `CameraPositionResolveTest`、ios-sdk の
// `CameraPositionResolveTests` と同じ観点を見る。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapCameraPosition, MapViewState, createMapCameraPosition } from '../dist/index.mjs';

const tokyo = { latitude: 35.6812, longitude: 139.7671 };
const osaka = { latitude: 34.7025, longitude: 135.4959 };
const current = createMapCameraPosition({ position: tokyo, zoom: 12, bearing: 30, tilt: 45 });

test('a position-only camera keeps everything else', () => {
  const resolved = createMapCameraPosition({ position: osaka }).resolvedOnto(current);
  assert.equal(resolved.position.latitude, osaka.latitude);
  assert.equal(resolved.zoom, 12);
  assert.equal(resolved.bearing, 30);
  assert.equal(resolved.tilt, 45);
});

test('an explicit 0 is honoured', () => {
  const resolved = createMapCameraPosition({ position: osaka, zoom: 0, bearing: 0, tilt: 0 })
    .resolvedOnto(current);
  assert.equal(resolved.zoom, 0);
  assert.equal(resolved.bearing, 0);
  assert.equal(resolved.tilt, 0);
});

test('each property is inherited on its own', () => {
  const zoomOnly = createMapCameraPosition({ position: osaka, zoom: 0 }).resolvedOnto(current);
  assert.deepEqual([zoomOnly.zoom, zoomOnly.bearing, zoomOnly.tilt], [0, 30, 45]);

  const bearingOnly = createMapCameraPosition({ position: osaka, bearing: 0 }).resolvedOnto(current);
  assert.deepEqual([bearingOnly.zoom, bearingOnly.bearing, bearingOnly.tilt], [12, 0, 45]);

  const tiltOnly = createMapCameraPosition({ position: osaka, tilt: 0 }).resolvedOnto(current);
  assert.deepEqual([tiltOnly.zoom, tiltOnly.bearing, tiltOnly.tilt], [12, 30, 0]);
});

test('an unset property reads 0 before resolving', () => {
  const camera = createMapCameraPosition({ position: osaka });
  assert.equal(camera.zoom, 0);
  assert.equal(camera.isZoomSpecified, false);
  assert.equal(camera.isBearingSpecified, false);
  assert.equal(camera.isTiltSpecified, false);
  assert.equal(MapCameraPosition.Default.isZoomSpecified, true);
});

test('copy and from keep an unset property unset', () => {
  const unset = createMapCameraPosition({ position: osaka });
  assert.equal(unset.copy({ position: tokyo }).isZoomSpecified, false);
  assert.equal(MapCameraPosition.from(unset).isZoomSpecified, false);

  const withZoom = unset.copy({ zoom: 0 });
  assert.equal(withZoom.isZoomSpecified, true);
  assert.equal(withZoom.isBearingSpecified, false);
});

class TestMapViewState extends MapViewState {
  mapDesignType = null;
}

test('MapViewState fills unset properties from the current camera', () => {
  const state = new TestMapViewState({ cameraPosition: current });

  state.moveCameraTo(createMapCameraPosition({ position: osaka, bearing: 0 }));
  assert.deepEqual(
    [state.cameraPosition.zoom, state.cameraPosition.bearing, state.cameraPosition.tilt],
    [12, 0, 45],
  );

  state.moveCameraTo(createMapCameraPosition({ position: osaka, zoom: 0 }));
  assert.equal(state.cameraPosition.zoom, 0);
});
