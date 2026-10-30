// マーカーのタイルを画面の画素密度で描くこと。
//
// タイルは何ピクセルの画像でも tileSize の CSS ピクセルとして並べられる。1x の画像を
// 2x の画面に出すと 2 倍に引き伸ばされ、アイコンやラベルがにじむ。`@2x` のタイルは
// 縦横 2 倍の画像に、同じ位置・大きさ（CSS ピクセル）で描く。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import {
    createGeoPoint,
    LocalTileServer,
    MarkerTileRenderer,
    parseTilePixelRatio,
    tilePixelRatio,
    tilePixelRatioSuffix,
} from '../dist/index.mjs';

// 描いた矩形を記録するだけの canvas（MarkerTileBounds.test.mjs と同じ考え方）
class Canvas {
    rectangles = [];
    constructor(width = 1, height = 1) { this.width = width; this.height = height; }
    getContext() {
        return {
            drawImage: (image, x, y, width = image.width, height = image.height) => {
                const rectangles = image.rectangles ?? [{ x: 0, y: 0, width: image.width, height: image.height }];
                for (const r of rectangles) {
                    const left = Math.max(0, x + r.x * width / image.width);
                    const top = Math.max(0, y + r.y * height / image.height);
                    const right = Math.min(this.width, x + (r.x + r.width) * width / image.width);
                    const bottom = Math.min(this.height, y + (r.y + r.height) * height / image.height);
                    if (right > left && bottom > top) this.rectangles.push({ x: left, y: top, width: right - left, height: bottom - top });
                }
            },
        };
    }
    async convertToBlob() { return new Blob([JSON.stringify({ size: [this.width, this.height], rectangles: this.rectangles })]); }
}
globalThis.OffscreenCanvas = Canvas;
globalThis.HTMLCanvasElement = Canvas;
globalThis.document = { createElement: () => new Canvas() };
// Service Worker へ渡せるのは ImageBitmap だけなので、その形も用意する
globalThis.ImageBitmap = class ImageBitmap {
    constructor(width, height) { this.width = width; this.height = height; }
};
globalThis.createImageBitmap = async (source) => {
    if (source instanceof ImageBitmap) return new ImageBitmap(source.width, source.height);
    if (source instanceof Canvas) return new ImageBitmap(source.width, source.height);
    if (typeof source.text !== 'function') return new ImageBitmap(source.naturalWidth, source.naturalHeight);
    const svg = await source.text();
    return new ImageBitmap(Number(svg.match(/width="([\d.]+)"/)[1]), Number(svg.match(/height="([\d.]+)"/)[1]));
};

const svgUrl = (width, height) =>
    'data:image/svg+xml,' + encodeURIComponent(`<svg width="${width}" height="${height}"></svg>`);

test('画面の画素密度から、タイルの倍率を決める（2 で頭打ち、端数は切り上げ）', () => {
    for (const [dpr, expected] of [[undefined, 1], [Number.NaN, 1], [0.75, 1], [1, 1], [1.25, 2], [2, 2], [2.625, 2], [3, 2]]) {
        assert.equal(tilePixelRatio(dpr), expected, `devicePixelRatio ${dpr}`);
    }
});

test('URL の @2x は 2x のときだけ付け、読むときは 1〜3 に収める', () => {
    assert.equal(tilePixelRatioSuffix(undefined), '');
    assert.equal(tilePixelRatioSuffix(1), '');
    assert.equal(tilePixelRatioSuffix(2), '@2x');
    assert.equal(parseTilePixelRatio(undefined), 1);
    assert.equal(parseTilePixelRatio('@2x'), 2);
    assert.equal(parseTilePixelRatio('@9x'), 3);
    assert.equal(parseTilePixelRatio('@0x'), 1);

    const server = LocalTileServer.startServer();
    assert.equal(server.urlTemplate({ routeId: 'r', tileSize: 256, cacheKey: '3' }), '/__tiles/r/256/3/{z}/{x}/{y}.png');
    assert.equal(server.urlTemplate({ routeId: 'r', tileSize: 256, cacheKey: '3', pixelRatio: 2 }), '/__tiles/r/256/3/{z}/{x}/{y}@2x.png');
});

const worker = readFileSync(new URL('../dist/tile-sw.js', import.meta.url), 'utf8');
function serviceWorker() {
    const handlers = {};
    const context = vm.createContext({
        self: { addEventListener: (name, handler) => { handlers[name] = handler; } },
        console: { log() {}, debug() {}, warn() {} }, OffscreenCanvas: Canvas, Blob,
    });
    vm.runInContext(worker + '\nglobalThis.api = {renderOffscreen, swProviders, parseTileUrl};', context);
    return { handlers, api: context.api };
}

test('Service Worker は URL の @2x を読み、無ければ 1x として扱う', () => {
    const { api } = serviceWorker();
    assert.equal(api.parseTileUrl('/__tiles/r/256/3/16/58211/25803.png').pixelRatio, 1);
    assert.equal(api.parseTileUrl('/__tiles/r/256/3/16/58211/25803@2x.png').pixelRatio, 2);
    assert.equal(api.parseTileUrl('/__tiles/r/256/16/58211/25803@2x.png').y, 25803);
    assert.equal(api.parseTileUrl('/__tiles/r/256/3/16/58211/25803@9x.png').pixelRatio, 3);
});

// タイルの左上から (dx, dy) CSS ピクセルの位置に、54x54・下端中央を先端とするピン
const req = { x: 58211, y: 25803, z: 16 };
function position(dx, dy) {
    const world = 256 * 2 ** req.z;
    return createGeoPoint({
        longitude: (req.x * 256 + dx) / world * 360 - 180,
        latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * (req.y * 256 + dy) / world))) * 180 / Math.PI,
    });
}
const pin = { size: { width: 54, height: 54 }, anchor: { x: 0.5, y: 1 }, url: svgUrl(54, 54) };
const markers = [{ position: position(100.3, 120.7), icon: { toBitmapIcon: () => pin } }];
// 1x と同じ位置・大きさを、2 倍してから整数に丸める
const expected2x = {
    size: [512, 512],
    rectangles: [{
        x: Math.round((100.3 - 27) * 2),
        y: Math.round((120.7 - 54) * 2),
        width: 108,
        height: 108,
    }],
};

test('Service Worker: @2x のタイルは 2 倍の画像に、同じ位置・大きさで描く', async () => {
    const { handlers, api } = serviceWorker();
    handlers.message({ data: { type: 'sw-register', routeId: 'test',
        items: [{ lat: markers[0].position.latitude, lng: markers[0].position.longitude, iconIndex: 0 }],
        icons: [{ ...pin, bitmap: { width: 108, height: 108 } }],
        zoomScales: Array(23).fill(1), extraIconScale: 1 } });
    const provider = api.swProviders.get('test');

    const at2x = await api.renderOffscreen(provider, req.x, req.y, req.z, 256, 2);
    assert.deepEqual(JSON.parse(await at2x.blob.text()), expected2x);

    // 倍率を渡さなければ従来どおり 1x
    const at1x = JSON.parse(await (await api.renderOffscreen(provider, req.x, req.y, req.z, 256)).blob.text());
    assert.deepEqual(at1x.size, [256, 256]);
    assert.deepEqual(at1x.rectangles, [{ x: Math.round(100.3 - 27), y: Math.round(120.7 - 54), width: 54, height: 54 }]);
});

test('メインスレッドの描画も、要求の倍率で描き、倍率ごとに別のタイルとして持つ', async () => {
    const renderer = new MarkerTileRenderer(markers, 256);
    await renderer.preloadIcons();
    const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

    const at1x = decode(await renderer.renderTile(req));
    const at2x = decode(await renderer.renderTile({ ...req, pixelRatio: 2 }));
    assert.deepEqual(at1x.size, [256, 256]);
    assert.deepEqual(at2x, expected2x);
});

test('SVG のアイコンは倍率の大きさで描き起こし、大きさ（CSS ピクセル）は変えない', async () => {
    // <img> で SVG を読み、その大きさで canvas に描く経路を再現する
    globalThis.Image = class {
        set src(url) { this.url = url; }
        async decode() {
            const svg = decodeURIComponent(this.url.slice(this.url.indexOf(',') + 1));
            this.naturalWidth = Number(svg.match(/width="([\d.]+)"/)[1]);
            this.naturalHeight = Number(svg.match(/height="([\d.]+)"/)[1]);
        }
    };
    try {
        const at2x = await new MarkerTileRenderer(markers, 256, undefined, 1, false, 0, 2).toSWData();
        const icon = at2x.icons.find((i) => i.size.width === 54);
        assert.deepEqual([icon.bitmap.width, icon.bitmap.height], [108, 108]);
        assert.deepEqual(icon.size, { width: 54, height: 54 });

        const at1x = await new MarkerTileRenderer(markers, 256).toSWData();
        assert.equal(at1x.icons.find((i) => i.size.width === 54).bitmap.width, 54);
    } finally {
        delete globalThis.Image;
    }
});
