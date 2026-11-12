// An immediate move whose engine reports the new camera synchronously (MapLibre's
// jumpTo fires moveend inside the call) must leave that reported camera in the
// state. The optimistic write used to come after the controller call and
// overwrote it with the requested camera — for a GeoPoint move, a copy that
// still carried the previous visibleRegion.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapViewState, createGeoRectBounds, createMapCameraPosition } from '../dist/index.mjs';

const tokyo = { latitude: 35.6812, longitude: 139.7671 };
const osaka = { latitude: 34.7025, longitude: 135.4959 };

function regionAround(center) {
  const bounds = createGeoRectBounds();
  bounds.extend({ latitude: center.latitude - 0.05, longitude: center.longitude - 0.1 });
  bounds.extend({ latitude: center.latitude + 0.05, longitude: center.longitude + 0.1 });
  return { bounds, nearLeft: null, nearRight: null, farLeft: null, farRight: null };
}

/** A controller that, like jumpTo, reports the camera it landed on before returning. */
function syncController(state) {
  const landOn = (camera) => {
    state.updateCameraPosition(camera.copy({ visibleRegion: regionAround(camera.position), fov: 36.87 }));
    return Promise.resolve(true);
  };
  return { moveCamera: landOn, animateCamera: landOn, fitBounds: () => Promise.resolve(true) };
}

for (const [name, request] of [
  ['GeoPoint', osaka],
  ['camera', createMapCameraPosition({ position: osaka, zoom: 13 })],
]) {
  test(`an immediate ${name} move keeps the camera the engine reported`, () => {
    const state = new MapViewState({
      cameraPosition: createMapCameraPosition({ position: tokyo, zoom: 12, visibleRegion: regionAround(tokyo) }),
    });
    state.setController(syncController(state));
    state.moveCameraTo(request, 0);
    const camera = state.cameraPosition;
    assert.equal(camera.position.latitude, osaka.latitude);
    assert.ok(camera.visibleRegion.bounds.contains(osaka), 'visibleRegion follows the move');
    assert.equal(camera.fov, 36.87);
  });
}
