import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { createGeoPoint, MarkerTileRenderer } from '../dist/index.mjs';

// Record and clip image rectangles, including the padded-canvas -> tile crop.
// This tests actual renderer geometry without DOM/native canvas dependencies.
class Canvas {
    rectangles = [];
    constructor(width = 1, height = 1) { this.width = width; this.height = height; }
    getContext() {
        return { drawImage: (image, x, y, width = image.width, height = image.height) => {
            const rectangles = image.rectangles ?? [{ x: 0, y: 0, width: image.width, height: image.height }];
            for (const r of rectangles) {
                const left = Math.max(0, x + r.x * width / image.width);
                const top = Math.max(0, y + r.y * height / image.height);
                const right = Math.min(this.width, x + (r.x + r.width) * width / image.width);
                const bottom = Math.min(this.height, y + (r.y + r.height) * height / image.height);
                if (right > left && bottom > top) this.rectangles.push({ x: left, y: top, width: right - left, height: bottom - top });
            }
        } };
    }
    async convertToBlob() { return new Blob([JSON.stringify(this.rectangles)]); }
    toDataURL() { return 'data:application/json,' + encodeURIComponent(JSON.stringify(this.rectangles)); }
}
globalThis.OffscreenCanvas = Canvas;
globalThis.HTMLCanvasElement = Canvas;
globalThis.document = { createElement: () => new Canvas() };
globalThis.createImageBitmap = async (blob) => {
    const svg = await blob.text();
    return { width: Number(svg.match(/width="([\d.]+)"/)[1]), height: Number(svg.match(/height="([\d.]+)"/)[1]) };
};

function bitmap(width, height, anchor) {
    return { size: { width, height }, anchor, url: 'data:image/svg+xml,' + encodeURIComponent(`<svg width="${width}" height="${height}"></svg>`) };
}
function position(req, dx, dy) {
    const world = 256 * 2 ** req.z;
    return createGeoPoint({
        longitude: (req.x * 256 + dx) / world * 360 - 180,
        latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * (req.y * 256 + dy) / world))) * 180 / Math.PI,
    });
}
const worker = readFileSync(new URL('../src/tileserver/tile-sw.js', import.meta.url), 'utf8');
function serviceWorker() {
    const handlers = {};
    const context = vm.createContext({
        self: { addEventListener: (name, handler) => { handlers[name] = handler; } },
        console: { log() {}, debug() {}, warn() {} }, OffscreenCanvas: Canvas, Blob,
    });
    vm.runInContext(worker + '\nglobalThis.api = {renderOffscreen, swProviders};', context);
    return {
        register(items, icons, scale = 1, extra = 1) {
            handlers.message({ data: { type: 'sw-register', routeId: 'test', items, icons,
                zoomScales: Array(23).fill(scale), extraIconScale: extra } });
            return context.api.swProviders.get('test');
        },
        render: context.api.renderOffscreen,
    };
}

const cases = [
    { name: 'selected bottom-anchored pin below the tile', width: 54, height: 54, anchor: { x: .5, y: 1 }, dx: 128, dy: 290, scale: .5 + 12 / 28 },
    { name: 'top-anchored icon above the tile', width: 54, height: 54, anchor: { x: .5, y: 0 }, dx: 128, dy: -34 },
    { name: 'wide centered icon left of the tile', width: 120, height: 32, anchor: { x: .5, y: .5 }, dx: -40, dy: 128 },
    { name: 'wide centered icon right of the tile', width: 120, height: 32, anchor: { x: .5, y: .5 }, dx: 296, dy: 128 },
    { name: 'icon overlapping a tile corner', width: 54, height: 54, anchor: { x: 0, y: 0 }, dx: -34, dy: -34 },
    { name: 'small candidate must not hide a larger icon outside the first query', width: 54, height: 54, anchor: { x: .5, y: 1 }, dx: 128, dy: 290, small: true },
    { name: 'zoom callback and extra scale', width: 18, height: 18, anchor: { x: .5, y: 1 }, dx: 128, dy: 290, scale: 3, extra: 1.25 },
    { name: 'large icon anchored more than one tile away', width: 40, height: 700, anchor: { x: .5, y: 1 }, dx: 128, dy: 600 },
    { name: 'low zoom at high latitude', width: 54, height: 54, anchor: { x: .5, y: 1 }, dx: 128, dy: 290, req: { x: 8, y: 1, z: 4 } },
];

function fixture(c) {
    const req = c.req ?? { x: 58211, y: 25803, z: 16 };
    const image = bitmap(c.width, c.height, c.anchor);
    const marker = { position: position(req, c.dx, c.dy), icon: { toBitmapIcon: () => image } };
    const markers = [marker];
    if (c.small) {
        const small = bitmap(16, 16, { x: .5, y: .5 });
        markers.push({ position: position(req, 24, 64), icon: { toBitmapIcon: () => small } });
    }
    const scale = c.scale ?? 1, extra = c.extra ?? 1;
    const expected = markers.map((m, i) => {
        const b = m.icon.toBitmapIcon();
        const width = Math.max(b.size.width * scale * extra, 1), height = Math.max(b.size.height * scale * extra, 1);
        const dx = i ? 24 : c.dx, dy = i ? 64 : c.dy;
        const left = Math.max(0, dx - width * b.anchor.x), top = Math.max(0, dy - height * b.anchor.y);
        const right = Math.min(256, dx + width * (1 - b.anchor.x)), bottom = Math.min(256, dy + height * (1 - b.anchor.y));
        return { x: left, y: top, width: right - left, height: bottom - top };
    });
    return { req, markers, scale, extra, expected };
}
function check(actual, expected) {
    assert.notEqual(actual, null, 'an overlapping icon must not produce an empty tile');
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
        for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(actual[i][key] - expected[i][key]) < 1e-6,
                `${key}: actual=${actual[i][key]}, expected=${expected[i][key]}`);
        }
    }
}

for (const c of cases) {
    for (const path of ['async', 'data URL', 'Service Worker']) {
        test(`${path}: ${c.name}`, async () => {
            const f = fixture(c);
            let actual = null;
            if (path === 'Service Worker') {
                const sw = serviceWorker();
                const icons = f.markers.map(m => ({ ...m.icon.toBitmapIcon(), bitmap: m.icon.toBitmapIcon().size }));
                const items = f.markers.map((m, iconIndex) => ({ lat: m.position.latitude, lng: m.position.longitude, iconIndex }));
                const provider = sw.register(items, icons, f.scale, f.extra);
                const blob = await sw.render(provider, f.req.x, f.req.y, f.req.z, 256);
                if (blob) actual = JSON.parse(await blob.text());
            } else {
                const renderer = new MarkerTileRenderer(f.markers, 256, () => f.scale, f.extra);
                await renderer.preloadIcons();
                if (path === 'async') {
                    const bytes = await renderer.renderTile(f.req);
                    if (bytes) actual = JSON.parse(new TextDecoder().decode(bytes));
                } else {
                    const url = renderer.renderTileDataUrl(f.req);
                    if (url) actual = JSON.parse(decodeURIComponent(url.slice(url.indexOf(',') + 1)));
                }
            }
            check(actual, f.expected);
        });
    }
}

test('empty tiles do not scan every marker again for the same zoom', async () => {
    const icon = { toBitmapIcon: () => bitmap(54, 54, { x: .5, y: 1 }) };
    const markers = Array.from({ length: 1000 }, () => ({ position: createGeoPoint({ latitude: 0, longitude: 0 }), icon }));
    let calls = 0;
    const renderer = new MarkerTileRenderer(markers, 256, () => { calls++; return 1; });
    assert.equal(await renderer.renderTile({ x: 58211, y: 25803, z: 16 }), null);
    assert.equal(calls, markers.length);
    assert.equal(await renderer.renderTile({ x: 58212, y: 25803, z: 16 }), null);
    assert.equal(calls, markers.length);
});

test('Service Worker re-registration resets cached bounds for new icons', async () => {
    const sw = serviceWorker(), req = { x: 58211, y: 25803, z: 16 };
    const p = position(req, 128, 290), items = [{ lat: p.latitude, lng: p.longitude, iconIndex: 0 }];
    const icons = size => [{ ...bitmap(size, size, { x: .5, y: 1 }), bitmap: { width: size, height: size } }];
    const small = sw.register(items, icons(16));
    assert.equal(await sw.render(small, req.x, req.y, req.z, 256), null);
    const large = sw.register(items, icons(54));
    const blob = await sw.render(large, req.x, req.y, req.z, 256);
    assert.ok(blob);
    assert.equal(JSON.parse(await blob.text()).length, 1);
});
