// 投影座標の既定実装。上書きしないホルダは EPSG:3857 メートルを返す。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    MapCoordinateSystem,
    MapViewHolderBase,
    ProjectedUnit,
    createGeoPoint,
} from '../dist/index.mjs';

class PlainHolder extends MapViewHolderBase {
    mapView = null;
    map = null;
    toScreenOffset() {
        return null;
    }
}

describe('MapViewHolderBase projected points', () => {
    it('defaults to EPSG:3857 meters', () => {
        const system = new PlainHolder().coordinateSystem;
        assert.equal(system.code, 'EPSG:3857');
        assert.equal(system.unit, ProjectedUnit.Meters);
        assert.equal(system, MapCoordinateSystem.WebMercator);
    });

    it('projects Tokyo Station to EPSG:3857', () => {
        // 期待値は x = λ·a、y = a·ln(tan(π/4 + φ/2))（a = 6378137）。
        const point = new PlainHolder().toProjectedPoint(createGeoPoint({ latitude: 35.681236, longitude: 139.767125 }));
        assert.ok(Math.abs(point.x - 15558805.18) < 0.01, `x ${point.x}`);
        assert.ok(Math.abs(point.y - 4256848.12) < 0.01, `y ${point.y}`);
    });

    it('round-trips to the same point', () => {
        const holder = new PlainHolder();
        const original = createGeoPoint({ latitude: -33.8688, longitude: 151.2093 });
        const back = holder.fromProjectedPoint(holder.toProjectedPoint(original));
        assert.ok(Math.abs(back.latitude - original.latitude) < 1e-9);
        assert.ok(Math.abs(back.longitude - original.longitude) < 1e-9);
    });
});
