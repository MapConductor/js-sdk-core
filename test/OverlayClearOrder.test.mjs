import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    AbstractMarkerController,
    CircleController,
    CircleManager,
    GroundImageController,
    GroundImageManager,
    HexGeocellImpl,
    MarkerManager,
    PolygonController,
    PolygonManager,
    PolylineController,
    PolylineManager,
    RasterLayerController,
    RasterLayerManager,
    RasterLayerSource,
    createCircleState,
    createGeoPoint,
    createGeoRectBounds,
    createGroundImageState,
    createMarkerState,
    createPolygonState,
    createPolylineState,
    createRasterLayerState,
} from '../dist/index.mjs';

/**
 * clear() の後、地図に何も残らないこと。
 *
 * MapLibre / Mapbox / Mappls / MapTiler / TomTom / Longdo などの GL 系の描画担当は、
 * remove では何もせず、onPostProcess で manager の全部を描き直す。ここの偽レンダラも
 * 同じ作りにしてあり、`drawn` は最後の onPostProcess で描いたもの（＝地図に見えているもの）を表す。
 *
 * clear() が manager を空にする前に onPostProcess を呼ぶと、全部を描き直して残る。
 * 呼ばなければ、前に描いたものが残る。android-sdk / ios-sdk の OverlayClearOrder テストと同じ。
 */

const a = createGeoPoint({ latitude: 35.0, longitude: 139.0 });
const b = createGeoPoint({ latitude: 35.1, longitude: 139.1 });
const c = createGeoPoint({ latitude: 35.0, longitude: 139.1 });

/** GL 系の描画担当の作り。 */
class GlRenderer {
    constructor(manager) {
        this.manager = manager;
        this.drawn = [];
    }
    async onAdd(data) { return data.map((p) => p.state.id); }
    async onChange(data) { return data.map((p) => p.current.state.id); }
    async onRemove(_data) {}
    async onAnimate(_entity) {}
    async onCameraChanged(_camera) {}
    async onPostProcess() { this.drawn = this.manager.allEntities().map((e) => e.state.id).sort(); }
}

const kinds = [
    {
        name: 'polygon',
        make: (manager, renderer) => new (class extends PolygonController {})({ polygonManager: manager, renderer }),
        manager: () => new PolygonManager(),
        states: () => [
            createPolygonState({ points: [a, b, c], id: 'p1' }),
            createPolygonState({ points: [a, b, c], id: 'p2' }),
        ],
    },
    {
        name: 'polyline',
        make: (manager, renderer) => new (class extends PolylineController {})({ polylineManager: manager, renderer }),
        manager: () => new PolylineManager(),
        states: () => [
            createPolylineState({ points: [a, b], id: 'p1' }),
            createPolylineState({ points: [b, c], id: 'p2' }),
        ],
    },
    {
        name: 'circle',
        make: (manager, renderer) => new (class extends CircleController {})({ circleManager: manager, renderer }),
        manager: () => new CircleManager(),
        states: () => [
            createCircleState({ center: a, radiusMeters: 100, id: 'p1' }),
            createCircleState({ center: b, radiusMeters: 50, id: 'p2' }),
        ],
    },
    {
        name: 'groundImage',
        make: (manager, renderer) =>
            new (class extends GroundImageController {})({ groundImageManager: manager, renderer }),
        manager: () => new GroundImageManager(),
        states: () => {
            const bounds = createGeoRectBounds({ southWest: a, northEast: b });
            return [
                createGroundImageState({ bounds, imageUrl: 'https://example.com/a.png', id: 'p1' }),
                createGroundImageState({ bounds, imageUrl: 'https://example.com/b.png', id: 'p2' }),
            ];
        },
    },
    {
        name: 'rasterLayer',
        make: (manager, renderer) =>
            new (class extends RasterLayerController {})({ rasterLayerManager: manager, renderer }),
        manager: () => new RasterLayerManager(),
        states: () => [
            createRasterLayerState({ source: RasterLayerSource.UrlTemplate({ template: 'https://example.com/a/{z}/{x}/{y}.png' }), id: 'p1' }),
            createRasterLayerState({ source: RasterLayerSource.UrlTemplate({ template: 'https://example.com/b/{z}/{x}/{y}.png' }), id: 'p2' }),
        ],
    },
    {
        // MapLibre / Mapbox などのマーカーの描画担当も onRemove では地図に触らない。
        name: 'marker',
        make: (manager, renderer) => new (class extends AbstractMarkerController {})({ markerManager: manager, renderer }),
        manager: () => new MarkerManager(HexGeocellImpl.defaultGeocell()),
        states: () => [
            createMarkerState({ position: a, id: 'p1' }),
            createMarkerState({ position: b, id: 'p2' }),
        ],
    },
];

for (const kind of kinds) {
    test(`${kind.name} の clear 後は何も描かれていない`, async () => {
        const manager = kind.manager();
        const renderer = new GlRenderer(manager);
        const controller = kind.make(manager, renderer);
        await controller.add(kind.states());
        assert.deepEqual(renderer.drawn, ['p1', 'p2']);

        await controller.clear();

        assert.deepEqual(renderer.drawn, []);
    });
}
