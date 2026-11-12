// paddings の辺は省略でき、省略した辺だけが現在のカメラから引き継がれること。
// zoom / bearing / tilt の未指定と同じ規則（CameraPositionResolve.test.mjs）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapCameraPosition, MapPaddings, MapViewState, createMapCameraPosition } from '../dist/index.mjs';

const tokyo = { latitude: 35.6812, longitude: 139.7671 };
const osaka = { latitude: 34.7025, longitude: 135.4959 };
const current = createMapCameraPosition({
  position: tokyo,
  zoom: 12,
  bearing: 30,
  tilt: 45,
  paddings: { top: 10, left: 20, bottom: 30, right: 40 },
});

const sides = (p) => [p.top, p.left, p.bottom, p.right];

test('a given side is used, the unset ones come from the current camera', () => {
  const resolved = createMapCameraPosition({ position: osaka, paddings: { top: 300 } }).resolvedOnto(current);
  assert.deepEqual(sides(resolved.paddings), [300, 20, 30, 40]);
  assert.equal(MapPaddings.isFullySpecified(resolved.paddings), true);
});

test('an empty paddings object copies every side', () => {
  const resolved = createMapCameraPosition({ position: osaka, paddings: {} }).resolvedOnto(current);
  assert.deepEqual(sides(resolved.paddings), [10, 20, 30, 40]);
});

test('leaving paddings out altogether still means no padding', () => {
  const camera = createMapCameraPosition({ position: osaka, zoom: 3, bearing: 0, tilt: 0 });
  assert.deepEqual(sides(camera.paddings), [0, 0, 0, 0]);
  assert.equal(MapPaddings.isFullySpecified(camera.paddings), true);
  assert.deepEqual(sides(camera.resolvedOnto(current).paddings), [0, 0, 0, 0]);
});

test('an explicit 0 is honoured', () => {
  const resolved = createMapCameraPosition({ position: osaka, paddings: { top: 0, right: 0 } }).resolvedOnto(current);
  assert.deepEqual(sides(resolved.paddings), [0, 20, 30, 0]);
});

test('an unset side reads 0 and says so', () => {
  const camera = createMapCameraPosition({ position: osaka, paddings: { left: 5 } });
  assert.deepEqual(sides(camera.paddings), [0, 5, 0, 0]);
  assert.equal(camera.paddings.isTopSpecified, false);
  assert.equal(camera.paddings.isLeftSpecified, undefined);
  assert.equal(MapPaddings.isFullySpecified(camera.paddings), false);
});

test('copy and from keep a side unset', () => {
  const camera = createMapCameraPosition({ position: osaka, zoom: 3, bearing: 0, tilt: 0, paddings: { top: 300 } });
  assert.deepEqual(sides(camera.copy().resolvedOnto(current).paddings), [300, 20, 30, 40]);
  assert.deepEqual(sides(MapCameraPosition.from(camera).resolvedOnto(current).paddings), [300, 20, 30, 40]);
  assert.deepEqual(
    sides(camera.copy({ paddings: { bottom: 7 } }).resolvedOnto(current).paddings),
    [10, 20, 7, 40],
  );
});

test('the fast path is not taken while a side is unset', () => {
  const full = createMapCameraPosition({ position: osaka, zoom: 3, bearing: 0, tilt: 0, paddings: { top: 1, left: 2, bottom: 3, right: 4 } });
  assert.equal(full.resolvedOnto(current), full);
  const partial = createMapCameraPosition({ position: osaka, zoom: 3, bearing: 0, tilt: 0, paddings: { top: 1 } });
  assert.notEqual(partial.resolvedOnto(current), partial);
});

test('a null current padding fills unset sides with 0', () => {
  const noPadding = createMapCameraPosition({ position: tokyo, zoom: 12, paddings: null });
  const resolved = createMapCameraPosition({ position: osaka, paddings: { top: 300 } }).resolvedOnto(noPadding);
  assert.deepEqual(sides(resolved.paddings), [300, 0, 0, 0]);
});

class TestMapViewState extends MapViewState {
  mapDesignType = null;
}

test('moveCameraTo takes the unset sides from the state camera', () => {
  const state = new TestMapViewState({ cameraPosition: current });
  state.moveCameraTo(createMapCameraPosition({ position: osaka, paddings: { top: 300 } }));
  assert.deepEqual(sides(state.cameraPosition.paddings), [300, 20, 30, 40]);
});
