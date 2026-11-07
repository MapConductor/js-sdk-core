import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRasterLayerState,
  polygonTileRasterLayerState,
  RasterLayerController,
  RasterLayerManager,
  RasterLayerSource,
} from '../dist/index.mjs';

/**
 * 1 枚の地図に載るラスターレイヤーは 3 系統ある。アプリの RasterLayer（composition）、
 * マーカータイル（mc-marker-tiles）、ポリゴンタイル（mc-polygon-tiles）。
 *
 * ## なぜここを固定するか
 *
 * マーカータイルを composition([marker]) / clear() で載せ外ししていたプロバイダでは、
 * composition が「渡されなかったレイヤーを消す」ので、マーカータイルを載せるとアプリの
 * RasterLayer が、アプリの RasterLayer が変わるとマーカータイルが消え、どちらも自分の
 * データが次に変わるまで戻らなかった。clear() はポリゴンタイルまで消していた。
 * SDK が自分で載せるレイヤーは upsert / removeById で扱い、composition はアプリの
 * レイヤーだけを入れ替える。
 */

function controllerWithMap() {
  const onMap = new Set();
  const renderer = {
    async onAdd(data) { return data.map(({ state }) => (onMap.add(state.id), { id: state.id })); },
    async onChange(data) { return data.map(({ current }) => ({ id: current.state.id })); },
    async onRemove(data) { for (const e of data) onMap.delete(e.state.id); },
    async onPostProcess() {},
    async onCameraChanged() {},
  };
  class Controller extends RasterLayerController {}
  return { controller: new Controller({ rasterLayerManager: new RasterLayerManager(), renderer }), onMap };
}

const layer = (id) =>
  createRasterLayerState({ id, source: RasterLayerSource.UrlTemplate({ template: `https://example.com/${id}/{z}/{x}/{y}.png` }) });
const markerTiles = (version) =>
  createRasterLayerState({ id: 'mc-marker-tiles', source: RasterLayerSource.UrlTemplate({ template: `/__tiles/m/256/${version}/{z}/{x}/{y}.png` }) });

test('アプリの RasterLayer・マーカータイル・ポリゴンタイルは互いを消さない', async () => {
  const { controller, onMap } = controllerWithMap();
  await controller.composition([layer('relief')]);
  await controller.upsert(polygonTileRasterLayerState('/__tiles/p/256/1/{z}/{x}/{y}.png'));
  await controller.upsert(markerTiles(1));
  assert.deepEqual([...onMap].sort(), ['mc-marker-tiles', 'mc-polygon-tiles', 'relief']);

  // アプリの RasterLayer が変わっても、SDK のタイルは残る
  await controller.composition([layer('photo')]);
  assert.deepEqual([...onMap].sort(), ['mc-marker-tiles', 'mc-polygon-tiles', 'photo']);

  // マーカータイルの版が変わっても、ほかは残る
  await controller.upsert(markerTiles(2));
  assert.deepEqual([...onMap].sort(), ['mc-marker-tiles', 'mc-polygon-tiles', 'photo']);

  // マーカータイルを外しても、ほかは残る
  await controller.removeById('mc-marker-tiles');
  assert.deepEqual([...onMap].sort(), ['mc-polygon-tiles', 'photo']);
});
