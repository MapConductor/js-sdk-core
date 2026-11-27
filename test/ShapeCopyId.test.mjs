import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createCircleState,
    createGeoPoint,
    createGeoRectBounds,
    createGroundImageState,
    createPolygonState,
    createPolylineState,
} from '../dist/index.mjs';

// 図形の copy() も id を引き継がず、新しい中身から計算し直す（MarkerState と同じ）。
// 描画側は id で区別するので、引き継ぐと copy で増やした図形が元の図形を上書きし、
// 1 つにしか見えなかった。android-sdk / ios-sdk と同じ意味論。

const at = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const bounds = (s, w, n, e) => createGeoRectBounds({ southWest: at(s, w), northEast: at(n, e) });

const kinds = [
    {
        kind: 'circle',
        create: (id) => createCircleState({ id, center: at(35, 139), radiusMeters: 100 }),
        fresh: () => createCircleState({ center: at(36, 140), radiusMeters: 100 }),
        change: { center: at(36, 140) },
    },
    {
        kind: 'polyline',
        create: (id) => createPolylineState({ id, points: [at(35, 139), at(35.1, 139.1)] }),
        fresh: () => createPolylineState({ points: [at(36, 140), at(36.1, 140.1)] }),
        change: { points: [at(36, 140), at(36.1, 140.1)] },
    },
    {
        kind: 'polygon',
        create: (id) => createPolygonState({ id, points: [at(35, 139), at(35.1, 139), at(35.1, 139.1)] }),
        fresh: () => createPolygonState({ points: [at(36, 140), at(36.1, 140), at(36.1, 140.1)] }),
        change: { points: [at(36, 140), at(36.1, 140), at(36.1, 140.1)] },
    },
    {
        kind: 'groundImage',
        create: (id) => createGroundImageState({ id, bounds: bounds(35, 139, 35.1, 139.1), imageUrl: 'a.png' }),
        fresh: () => createGroundImageState({ bounds: bounds(36, 140, 36.1, 140.1), imageUrl: 'a.png' }),
        change: { bounds: bounds(36, 140, 36.1, 140.1) },
    },
];

for (const { kind, create, fresh, change } of kinds) {
    test(`${kind}: copy() で中身を変えると id も計算し直す`, () => {
        const base = create(undefined);
        const moved = base.copy(change);

        assert.notEqual(moved.id, base.id);
        assert.equal(moved.id, fresh().id);
    });

    test(`${kind}: 明示した id も copy() は引き継がない`, () => {
        assert.notEqual(create('s1').copy(change).id, 's1');
    });

    test(`${kind}: copy() に渡した id はそのまま使う`, () => {
        const base = create('s1');

        assert.equal(base.copy({ ...change, id: 's1' }).id, 's1');
        assert.equal(base.copy({ id: 's2' }).id, 's2');
        assert.equal(base.copy({ id: null }).id, base.copy().id);
    });
}
