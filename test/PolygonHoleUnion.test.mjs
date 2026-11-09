// unionHoleRings keeps the area of the union of the holes: holes that touch at a
// point or share (part of) an edge add up, overlaps count once. The fixture
// (test/resources/polygon-hole-union-fixture.txt) is the same file as
// android-sdk-core's PolygonHoleUnionFixtureTest and ios-sdk-core's
// PolygonHoleUnionFixtureTests read; the expected areas are shapely's unary_union.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createGeoPoint, createPolygonState, unionHoleRings, unionHoles } from '../dist/index.mjs';

const cases = [];
for (const line of readFileSync(new URL('./resources/polygon-hole-union-fixture.txt', import.meta.url), 'utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const parts = line.split('|');
    const numbers = () => parts[1].split(',').map(Number);
    if (parts[0] === 'case') {
        cases.push({
            name: parts[1],
            unit: Number(parts[2]),
            origin: [Number(parts[3]), Number(parts[4])],
            unionArea: Number(parts[5]),
            holes: [],
        });
    } else if (parts[0] === 'outer') {
        cases[cases.length - 1].outer = numbers();
    } else if (parts[0] === 'hole') {
        cases[cases.length - 1].holes.push(numbers());
    }
}

const toGeo = (flat, c) => {
    const points = [];
    for (let i = 0; i < flat.length; i += 2) {
        points.push(createGeoPoint({
            longitude: c.origin[0] + flat[i] * c.unit,
            latitude: c.origin[1] + flat[i + 1] * c.unit,
        }));
    }
    return points;
};

/** Planar area in grid units². */
const areaInUnits = (ring, c) => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        const px = (p.longitude - c.origin[0]) / c.unit, py = (p.latitude - c.origin[1]) / c.unit;
        const qx = (q.longitude - c.origin[0]) / c.unit, qy = (q.latitude - c.origin[1]) / c.unit;
        a += px * qy - qx * py;
    }
    return a / 2;
};

for (const c of cases) {
    test(`unionHoleRings keeps the area of the union: ${c.name}`, () => {
        const holes = c.holes.map((h) => toGeo(h, c));
        let result;
        if (c.outer) {
            const state = createPolygonState({ points: toGeo(c.outer, c), holes });
            const unioned = unionHoles(state);
            assert.equal(unioned.points, state.points, 'the outline is left alone');
            result = unioned.holes;
        } else {
            result = unionHoleRings(holes);
        }
        const area = result.reduce((sum, ring) => sum + Math.abs(areaInUnits(ring, c)), 0);
        assert.ok(
            Math.abs(area - c.unionArea) <= 1e-6 * c.unionArea,
            `area ${area} != union ${c.unionArea} (${result.length} rings from ${holes.length})`,
        );
        for (const ring of result) {
            assert.ok(areaInUnits(ring, c) < 0, 'holes come back clockwise');
        }
    });
}
