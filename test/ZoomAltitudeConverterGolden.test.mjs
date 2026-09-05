import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    AbstractZoomAltitudeConverter,
    GroundScaleZoomAltitudeConverter,
    WebMercatorZoomAltitudeConverter,
} from '../dist/index.mjs';

/**
 * {@link WebMercatorZoomAltitudeConverter} が移行前の各プロバイダ実装と
 * **1 ビットも違わない**ことを検証する。
 *
 * `src/zoom/ZoomAltitudeConverter.ts` は 8 プロバイダでほぼ同一（差はズームオフセットだけ）
 * だったので、コアの 1 本にまとめた。ただしズーム換算のズレは
 * **目視では絶対に見つからない回帰**（高緯度で縮尺がわずかに違う、程度にしか見えない）
 * なので、移行前の実装が返した値を表として採取し、それに対して固定する。
 *
 * `test/resources/zoom-golden.txt` は移行前（2026-08-10）の react-for-* の converter を
 * **1 文字も変えずに束ねて走らせ**採取したもの。
 * zoom 8 点 × 緯度 8 点 × tilt 5 点 = 320 点 × 11 プロバイダ。
 * android-sdk / ios-sdk の同名テストと同じ格子・同じ形式。
 *
 * ## googlemaps / cesium / arcgis を含めていない理由
 *
 * この 3 つは**式が本質的に違う**のでコアの実装に寄せていない。
 * いずれも `zoom0Altitude * (viewportHeight / REFERENCE_VIEWPORT_HEIGHT_PX)` で
 * ビューポート高さにスケールし、しかも **tilt を掛ける前に distance をクランプ**する
 * （コアは最後の altitude をクランプする）。この差は高ズームアウト域で実際に出る。
 * 自前実装のまま残すこと。
 */

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'resources', 'zoom-golden.txt');

/** 移行前の各プロバイダの構成。ここが実装との唯一の対応表。 */
const CONVERTERS = {
    // 512px タイルのベクタエンジン。統一ズーム = ネイティブズーム + 1。
    maplibre: () => new WebMercatorZoomAltitudeConverter(undefined, 1.0),
    mapbox: () => new WebMercatorZoomAltitudeConverter(undefined, 1.0),
    maptiler: () => new WebMercatorZoomAltitudeConverter(undefined, 1.0),
    longdo: () => new WebMercatorZoomAltitudeConverter(undefined, 1.0),
    azuremaps: () => new WebMercatorZoomAltitudeConverter(undefined, 1.0),
    // TomTom Orbis の web は MapLibre GL JS なので web も 1.0。
    // ネイティブの TomTom SDK だけがグラウンドスケール（1.76 + log2 cos φ）。
    tomtom: () => new WebMercatorZoomAltitudeConverter(undefined, 1.0),
    // 256px 基準。ネイティブズーム == 統一ズーム。
    mapkit: () => new WebMercatorZoomAltitudeConverter(undefined, 0.0),
    here: () => new WebMercatorZoomAltitudeConverter(undefined, 0.0),
};

function goldenRows() {
    return readFileSync(GOLDEN, 'utf8')
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
            const [provider, zoom, latitude, tilt, altitude, roundTrip] = line.split('|');
            return {
                provider,
                zoom: Number(zoom),
                latitude: Number(latitude),
                tilt: Number(tilt),
                altitude: Number(altitude),
                roundTrip: Number(roundTrip),
            };
        });
}

test('ゴールデン表が想定の件数ある', () => {
    const rows = goldenRows();
    assert.equal(rows.length, 3520, '11 プロバイダ x 320 点');
    assert.equal(new Set(rows.map((r) => r.provider)).size, 11);
});

test('zoomLevelToAltitude が移行前と完全に一致する', () => {
    const failures = [];
    for (const row of goldenRows()) {
        const make = CONVERTERS[row.provider];
        if (!make) continue;
        const actual = make().zoomLevelToAltitude({
            zoomLevel: row.zoom,
            latitude: row.latitude,
            tilt: row.tilt,
        });
        // 丸め誤差の許容ではなく完全一致を要求する。式を 1 本にまとめただけなので、
        // 差が出たらそれは実装の変化であって数値誤差ではない。
        if (actual !== row.altitude) {
            failures.push(
                `${row.provider} z=${row.zoom} lat=${row.latitude} tilt=${row.tilt}: expected=${row.altitude} actual=${actual}`,
            );
        }
    }
    assert.equal(
        failures.length,
        0,
        `移行前と値が変わった箇所が ${failures.length} 件:\n${failures.slice(0, 10).join('\n')}`,
    );
});

test('altitudeToZoomLevel が移行前と完全に一致する', () => {
    const failures = [];
    for (const row of goldenRows()) {
        const make = CONVERTERS[row.provider];
        if (!make) continue;
        const actual = make().altitudeToZoomLevel({
            altitude: row.altitude,
            latitude: row.latitude,
            tilt: row.tilt,
        });
        if (actual !== row.roundTrip) {
            failures.push(
                `${row.provider} alt=${row.altitude} lat=${row.latitude} tilt=${row.tilt}: expected=${row.roundTrip} actual=${actual}`,
            );
        }
    }
    assert.equal(
        failures.length,
        0,
        `移行前と値が変わった箇所が ${failures.length} 件:\n${failures.slice(0, 10).join('\n')}`,
    );
});

test('寄せていない 3 プロバイダはコアの式と一致しない（寄せてしまったら気づけるように）', () => {
    const core = new WebMercatorZoomAltitudeConverter(undefined, 0.0);
    for (const provider of ['googlemaps', 'cesium', 'arcgis']) {
        const rows = goldenRows().filter((r) => r.provider === provider);
        assert.equal(rows.length, 320, provider);
        const mismatches = rows.filter(
            (r) =>
                core.zoomLevelToAltitude({ zoomLevel: r.zoom, latitude: r.latitude, tilt: r.tilt }) !==
                r.altitude,
        );
        assert.ok(
            mismatches.length > 0,
            `${provider} がコアの式と完全一致した。ビューポート依存の較正が消えていないか確認すること`,
        );
    }
});

// ── 性質テスト（ゴールデン表とは独立に式の健全性を押さえる） ──────────────

test('クランプ域を除けば往復して元のズームに戻る', () => {
    const converter = new WebMercatorZoomAltitudeConverter(undefined, 1.0);
    for (const zoomLevel of [2.0, 5.0, 10.0, 14.0, 18.0]) {
        for (const latitude of [-60.0, 0.0, 35.7, 60.0]) {
            const altitude = converter.zoomLevelToAltitude({ zoomLevel, latitude, tilt: 0.0 });
            const back = converter.altitudeToZoomLevel({ altitude, latitude, tilt: 0.0 });
            assert.ok(Math.abs(back - zoomLevel) < 1e-9, `zoom=${zoomLevel} lat=${latitude} -> ${back}`);
        }
    }
});

test('ズームが増えると高度は単調に減る', () => {
    const converter = new WebMercatorZoomAltitudeConverter(undefined, 0.0);
    let previous = Number.MAX_VALUE;
    for (let zoomLevel = 1; zoomLevel <= 20; zoomLevel += 1) {
        const altitude = converter.zoomLevelToAltitude({ zoomLevel, latitude: 35.7, tilt: 0.0 });
        assert.ok(altitude < previous, `zoom=${zoomLevel} で単調減少が崩れた`);
        previous = altitude;
    }
});

test('tilt が 90 度でも極付近でも発散しない', () => {
    const converter = new WebMercatorZoomAltitudeConverter(undefined, 0.0);
    const atHorizon = converter.zoomLevelToAltitude({ zoomLevel: 10.0, latitude: 0.0, tilt: 90.0 });
    assert.ok(Number.isFinite(atHorizon));
    assert.ok(atHorizon >= AbstractZoomAltitudeConverter.MIN_ALTITUDE);

    for (const latitude of [-90.0, -89.9, 89.9, 90.0]) {
        const altitude = converter.zoomLevelToAltitude({ zoomLevel: 10.0, latitude, tilt: 0.0 });
        assert.ok(Number.isFinite(altitude) && altitude > 0, `lat=${latitude}`);
    }
});

test('オフセットは統一ズームとネイティブズームの間で往復する', () => {
    const converter = new WebMercatorZoomAltitudeConverter(undefined, 1.0);
    assert.ok(Math.abs(converter.toUnifiedZoom(10.0) - 11.0) < 1e-12);
    assert.ok(Math.abs(converter.toNativeZoom(11.0) - 10.0) < 1e-12);
});

test('グラウンドスケール版のオフセットは緯度に依存する', () => {
    const converter = new GroundScaleZoomAltitudeConverter(undefined, 1.76);
    // cos(60°) = 0.5 なので log2 で -1.0 ぶんずれる。
    assert.ok(Math.abs(converter.toUnifiedZoom(10.0, 0.0) - 11.76) < 1e-9);
    assert.ok(Math.abs(converter.toUnifiedZoom(10.0, 60.0) - 10.76) < 1e-9);
});
