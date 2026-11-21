import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * PolylineState / PolygonState の変更の届け方。
 *
 * 以前は 1 本ごとに getter / setter / クロージャのオブジェクトと subject を作り、
 * 書き込みのたびに fingerprint を emit して distinctUntilChanged で間引いていた。
 * いまは CircleState と同じく prototype の class で、collector は共有チャネル
 * （polylineMutations / polygonMutations）で変更を受け取る。
 *
 * ここで固定するのは「間引き方が以前と同じ」こと: fingerprint が変わらない書き込み
 * （同じ座標の新しい配列、onClick の差し替え）は誰にも届かない。届くようになると、
 * 毎レンダー新しい配列を渡すアプリで描き直しが毎回走る。
 */
const {
  createGeoPoint,
  createPolylineState,
  createPolygonState,
  polylineMutations,
  polygonMutations,
  OverlayCollector,
} = await import('../dist/index.mjs');

const p = (latitude, longitude) => createGeoPoint({ latitude, longitude });
const line = () => [p(35, 139), p(35.1, 139.1)];
const ring = () => [p(35, 139), p(35.1, 139), p(35.1, 139.1)];
const settle = () => new Promise((r) => setTimeout(r, 40));

for (const [kind, create, mutations, shape] of [
  ['polyline', createPolylineState, polylineMutations, line],
  ['polygon', createPolygonState, polygonMutations, ring],
]) {
  test(`${kind}: a write that leaves the fingerprint as it was reaches no one`, () => {
    const state = create({ id: kind, points: shape() });
    const seen = [];
    const stop = mutations.subscribe((s) => seen.push(s));
    try {
      state.points = shape();
      state.strokeWidth = state.strokeWidth;
      state.onClick = () => {};
      state.onAdded = () => {};
      assert.equal(seen.length, 0);
      state.strokeWidth = 7;
      assert.deepEqual(seen, [state]);
    } finally {
      stop();
    }
  });

  test(`${kind}: a point moved in place is seen when the array is assigned again`, () => {
    const state = create({ id: kind, points: shape() });
    const seen = [];
    const stop = mutations.subscribe((s) => seen.push(s));
    try {
      const before = state.fingerPrint().points;
      state.points[0] = p(36, 140);
      assert.notEqual(state.fingerPrint().points, before);
      state.points = state.points;
      assert.equal(seen.length, 1);
    } finally {
      stop();
    }
  });

  test(`${kind}: asObservable replays the current fingerprint and then each change`, () => {
    const state = create({ id: kind, points: shape() });
    state.strokeColor = '#123456';
    const received = [];
    const unsubscribe = state.asObservable().subscribe((fp) => received.push(fp));
    assert.deepEqual(received, [state.fingerPrint()]);
    state.onClick = () => {};
    assert.equal(received.length, 1);
    state.zIndex = 3;
    assert.equal(received.length, 2);
    unsubscribe();
    state.zIndex = 4;
    assert.equal(received.length, 2);
  });

  test(`${kind}: the collector hears changes through the shared channel, not per state`, async () => {
    const state = create({ id: kind, points: shape() });
    state.asObservable = () => { throw new Error(`collector subscribed to a ${kind}`); };
    const collector = new OverlayCollector(mutations);
    const updates = [];
    collector.setUpdateHandler((s) => updates.push(s.strokeWidth));
    try {
      collector.add(state);
      state.strokeWidth = 5;
      await settle();
      assert.deepEqual(updates, [5]);
      collector.remove(state.id);
      state.strokeWidth = 6;
      await settle();
      assert.deepEqual(updates, [5]);
    } finally {
      collector.setUpdateHandler(null);
    }
  });

  test(`${kind}: copy keeps the id and values and is a separate state`, () => {
    const state = create({ id: kind, points: shape(), strokeColor: '#ff0000', zIndex: 2, extra: 'x' });
    const copied = state.copy({ strokeWidth: 9 });
    assert.equal(copied.id, state.id);
    assert.equal(copied.strokeColor, '#ff0000');
    assert.equal(copied.zIndex, 2);
    assert.equal(copied.extra, 'x');
    assert.equal(copied.strokeWidth, 9);
    assert.notEqual(copied, state);
    assert.equal(state.copy().equals(state), true);
  });
}

test('polygon: holes count toward the fingerprint and are compared by value', () => {
  const state = createPolygonState({ id: 'holes', points: ring(), holes: [ring()] });
  const seen = [];
  const stop = polygonMutations.subscribe((s) => seen.push(s));
  try {
    state.holes = [ring()];
    assert.equal(seen.length, 0);
    state.holes = [];
    assert.equal(seen.length, 1);
  } finally {
    stop();
  }
});
