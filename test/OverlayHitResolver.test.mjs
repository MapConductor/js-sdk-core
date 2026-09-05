import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    BaseMapViewController,
    CANONICAL_ORDER,
    createGeoPoint,
    createOverlayHit,
    OverlayHitResolver,
} from '../dist/index.mjs';

/**
 * クリックカスケードの順序と先勝ち。
 *
 * android-sdk の `OverlayHitResolverTest` と 1 対 1 で対応する。
 *
 * ## なぜここを固定するか
 *
 * 13 プロバイダが同じカスケードを各自書いていて、**順序が揃っていなかった**:
 *   - Azure Maps  … circle → polyline → polygon → groundImage
 *   - Leaflet     … polyline → polygon → circle → groundImage
 *   - 正準（android）… circle → groundImage → polyline → polygon
 * 面積の小さい・上に載るものから見るのが正しい。ここで 1 本にする。
 *
 * また **1 タップで 2 つ配送してはいけない**。オーバーレイに当たったのに
 * 地図クリックも飛ぶ二重配送は、アプリから見て観測できる不具合になる。
 */

function slot(kind, { hits = false, clicked = null } = {}) {
    const controller = {
        kind,
        dispatched: 0,
        hasId: () => false,
        compositionAny: async () => {},
        updateAny: async () => {},
        setClickListenerAny: () => {},
        resolveTap(position) {
            if (!hits) return null;
            return createOverlayHit(kind, clicked ?? position, () => {
                controller.dispatched += 1;
            });
        },
    };
    return controller;
}

const POINT = createGeoPoint({ latitude: 0, longitude: 0 });

test('正準順は circle → groundImage → polyline → polygon', () => {
    assert.deepEqual([...CANONICAL_ORDER], ['circle', 'groundImage', 'polyline', 'polygon']);
    assert.ok(!CANONICAL_ORDER.includes('marker'), 'マーカーは別経路（画面投影が要る）');
    assert.ok(!CANONICAL_ORDER.includes('rasterLayer'), 'ラスターレイヤはクリックを持たない');
});

test('登録順に関係なく正準順で解決する', () => {
    // わざと逆順に登録する。順序は登録順ではなく kind で決まる。
    const polygon = slot('polygon', { hits: true });
    const polyline = slot('polyline', { hits: true });
    const groundImage = slot('groundImage', { hits: true });
    const circle = slot('circle', { hits: true });
    const controllers = [polygon, polyline, groundImage, circle];

    const hit = OverlayHitResolver.resolve(controllers, POINT);
    assert.equal(hit.kind, 'circle', '面積の小さい circle が先');
});

test('先に当たった 1 つだけを返す（副作用は dispatch まで起きない）', () => {
    const circle = slot('circle', { hits: true });
    const polygon = slot('polygon', { hits: true });
    const hit = OverlayHitResolver.resolve([circle, polygon], POINT);

    assert.equal(circle.dispatched, 0, '解決しただけでは配送しない');
    hit.dispatch();
    assert.equal(circle.dispatched, 1);
    assert.equal(polygon.dispatched, 0, '2 つめへは配送しない');
});

test('どれにも当たらなければ null', () => {
    const controllers = ['circle', 'groundImage', 'polyline', 'polygon'].map((k) => slot(k));
    assert.equal(OverlayHitResolver.resolve(controllers, POINT), null);
});

test('スロットに参加していないコントローラは無視する', () => {
    const cameraOnly = { onCameraChanged() {}, destroy() {} };
    const circle = slot('circle', { hits: true });
    const hit = OverlayHitResolver.resolve([cameraOnly, circle], POINT);
    assert.equal(hit.kind, 'circle');
});

test('探索順を差し替えられる', () => {
    const circle = slot('circle', { hits: true });
    const polygon = slot('polygon', { hits: true });
    const hit = OverlayHitResolver.resolve([circle, polygon], POINT, ['polygon', 'circle']);
    assert.equal(hit.kind, 'polygon');
});

// ── dispatchTap（marker → overlay → map の一本道） ──────────────────────

class TestController extends BaseMapViewController {
    markerHits = false;
    dispatchMarkerTap() {
        return this.markerHits;
    }
}

test('オーバーレイに当たったら地図クリックは飛ばない（二重配送の防止）', () => {
    const controller = new TestController();
    const circle = slot('circle', { hits: true });
    controller.registerOverlayController(circle);
    let mapClicks = 0;
    controller.setMapClickListener(() => {
        mapClicks += 1;
    });

    assert.equal(controller.dispatchTap(POINT), true);
    assert.equal(circle.dispatched, 1);
    assert.equal(mapClicks, 0, 'オーバーレイに当たったら地図クリックは飛ばない');
});

test('どのオーバーレイにも当たらなければ地図クリックへ落ちる', () => {
    const controller = new TestController();
    controller.registerOverlayController(slot('polygon'));
    let mapClicks = 0;
    controller.setMapClickListener(() => {
        mapClicks += 1;
    });

    controller.dispatchTap(POINT);
    assert.equal(mapClicks, 1);
});

test('マーカーが消費したらオーバーレイも地図クリックも見ない', () => {
    const controller = new TestController();
    controller.markerHits = true;
    const circle = slot('circle', { hits: true });
    controller.registerOverlayController(circle);
    let mapClicks = 0;
    controller.setMapClickListener(() => {
        mapClicks += 1;
    });

    controller.dispatchTap(POINT);
    assert.equal(circle.dispatched, 0);
    assert.equal(mapClicks, 0);
});

test('dispatchOverlayTap はマーカーを含まない（ネイティブのリスナーから呼べる）', () => {
    const controller = new TestController();
    controller.markerHits = true; // マーカーは当たる設定
    const circle = slot('circle', { hits: true });
    controller.registerOverlayController(circle);

    assert.equal(controller.dispatchOverlayTap(POINT), true);
    assert.equal(circle.dispatched, 1, 'マーカーを飛ばしてオーバーレイだけを見る');
});
