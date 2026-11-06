// URL を渡した ImageIcon（`new ImageIcon(url)`）。
//
// - 同じ URL は 1 回しか読まない。
// - 読み終えるまでは透明な絵で、読み終えたときにハッシュが一度だけ変わる。
// - マーカーは、そのアイコンを持ったままなら読み終えたときに描き直される（指紋が流れる）。
// - 読めなかった画像は透明のまま。
//
// DOM が無いので、Image は読み込みをテストから終わらせられる偽物、canvas は描画命令を記録する偽物。

import { test } from 'node:test';
import assert from 'node:assert/strict';

const loads = new Map(); // url -> { resolve, reject, image }
globalThis.HTMLImageElement = class {};
globalThis.Image = class extends globalThis.HTMLImageElement {
    constructor() {
        super();
        this.width = 64;
        this.height = 64;
    }
    decode() {
        return new Promise((resolve, reject) => {
            assert.equal(this.crossOrigin, 'anonymous');
            assert.ok(!loads.has(this.src), `loaded twice: ${this.src}`);
            loads.set(this.src, { resolve, reject, image: this });
        });
    }
};
const drawn = [];
globalThis.document = {
    createElement() {
        const context = new Proxy(
            {
                measureText: (text) => ({ width: [...text].length * 10 }),
                drawImage: (image) => drawn.push(image),
            },
            { get: (target, key) => target[key] ?? (() => {}), set: () => true },
        );
        return { width: 0, height: 0, getContext: () => context, toDataURL: () => `data:image/png;test,${drawn.length}` };
    },
};
const warn = console.warn;
console.warn = () => {};

const { ImageIcon, createMarkerState, createGeoPoint } = await import('../dist/index.mjs');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const position = createGeoPoint({ latitude: 35, longitude: 139 });

test('同じ URL は 1 回だけ読み、読み終えたら後から作ったアイコンもすぐ使える', async () => {
    const url = 'https://example.com/dedupe.png';
    const a = new ImageIcon(url);
    const b = new ImageIcon(url, { scale: 2 });
    assert.ok(loads.has(url));
    assert.equal(a.imageUrl, url);
    loads.get(url).resolve();
    await tick();
    assert.equal(a.image, loads.get(url).image);
    assert.equal(b.image, loads.get(url).image);
    const later = new ImageIcon(url);
    assert.equal(later.image, loads.get(url).image);
    assert.equal(later.hashCode(), a.hashCode());
});

test('読み終えるまでは透明で、読み終えたときにハッシュが一度だけ変わる', async () => {
    const url = 'https://example.com/hash.png';
    const icon = new ImageIcon(url, { iconSize: 20 });
    const pendingHash = icon.hashCode();
    drawn.length = 0;
    const placeholder = icon.toBitmapIcon();
    assert.equal(drawn.length, 0, 'nothing is drawn before the image arrives');
    assert.deepEqual(placeholder.size, { width: 20, height: 20 });
    loads.get(url).resolve();
    await tick();
    assert.notEqual(icon.hashCode(), pendingHash);
    const ready = icon.toBitmapIcon();
    assert.notEqual(ready, placeholder);
    assert.equal(drawn.at(-1), loads.get(url).image);
    assert.deepEqual(ready.size, placeholder.size);
    assert.equal(icon.hashCode(), icon.hashCode());
});

test('ラベル付きでも本体はラベルの無い同じ URL のアイコンと同じ画像になる', async () => {
    const url = 'https://example.com/label.png';
    const labelled = new ImageIcon(url, { iconSize: 10, label: 'ABC', labelPosition: 'right' });
    const pendingBody = labelled.tileParts().body;
    loads.get(url).resolve();
    await tick();
    const body = labelled.tileParts().body;
    assert.notEqual(body, pendingBody, 'tile parts are rebuilt once the image arrives');
    assert.equal(body.url, new ImageIcon(url, { iconSize: 10 }).toBitmapIcon().url);
});

test('マーカーは同じアイコンを持っていれば、読み終えたときに描き直される', async () => {
    const url = 'https://example.com/marker.png';
    const icon = new ImageIcon(url);
    const kept = createMarkerState({ position, icon });
    const replaced = createMarkerState({ position, icon });
    // 何度代入しても待ちは 1 つ
    kept.icon = icon;
    kept.icon = icon;
    const keptPrints = [];
    const replacedPrints = [];
    kept.asObservable().subscribe((print) => keptPrints.push(print));
    replaced.asObservable().subscribe((print) => replacedPrints.push(print));
    const other = new ImageIcon(url, { scale: 3 });
    replaced.icon = other;
    // subscribe した時点の指紋と、差し替えの分は数えない
    keptPrints.length = 0;
    replacedPrints.length = 0;

    loads.get(url).resolve();
    await tick();
    assert.equal(keptPrints.length, 1);
    assert.equal(keptPrints[0].icon, icon.hashCode());
    // replaced は差し替えた先（同じ URL）が読み終えたので 1 回だけ流れる。元のアイコンの分は流れない。
    assert.equal(replacedPrints.length, 1);
    assert.equal(replacedPrints[0].icon, other.hashCode());
});

test('読めなかった画像は透明のままで、マーカーは一度だけ知らされる', async () => {
    const url = 'https://example.com/missing.png';
    const icon = new ImageIcon(url);
    const marker = createMarkerState({ position, icon });
    const prints = [];
    marker.asObservable().subscribe((print) => prints.push(print));
    prints.length = 0;
    const pendingHash = icon.hashCode();
    loads.get(url).reject(new Error('404'));
    await tick();
    assert.equal(prints.length, 1);
    assert.notEqual(icon.hashCode(), pendingHash);
    drawn.length = 0;
    icon.toBitmapIcon();
    assert.equal(drawn.length, 0);
    // 失敗も覚えていて、もう一度は読みに行かない（読みに行くと偽物の decode が投げる）
    const again = new ImageIcon(url);
    assert.equal(again.hashCode(), icon.hashCode());
});

test('画像ソースで作ったアイコンは従来どおり', () => {
    const source = { width: 8, height: 8 };
    const icon = new ImageIcon(source);
    assert.equal(icon.imageUrl, null);
    assert.equal(icon.image, source);
    assert.equal(icon.onceImageSettled(() => {}), false);
    drawn.length = 0;
    new ImageIcon(source, { iconSize: 11, label: 'X' }).tileParts();
    assert.equal(drawn.at(-1), source);
});

test.after(() => {
    console.warn = warn;
});
