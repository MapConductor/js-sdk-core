// 画像アイコン（ImageIcon）にもラベルを付けられ、labelPosition が既定のピンと同じ書き方で効くこと。
//
// 画像の正方形全体を本体として扱い、ラベルはその外側（既定は中央に重ねる）に置く。
// ビットマップがラベルの側へ伸びても、アンカーは画像の同じ点を指し続けなければならない。
// DOM が無いので、canvas は描画命令を記録するだけの偽物で、文字幅は 1 文字 10px とする。

import { test } from 'node:test';
import assert from 'node:assert/strict';

const canvases = [];
globalThis.HTMLImageElement = class {};
globalThis.document = {
    createElement() {
        const ops = [];
        const context = new Proxy(
            { measureText: (text) => ({ width: text.length * 10 }) },
            { get: (target, key) => target[key] ?? ((...args) => ops.push([key, ...args])), set: (target, key, value) => { ops.push([key, value]); return true; } },
        );
        const canvas = { width: 0, height: 0, ops, getContext: () => context, toDataURL: () => `data:image/png;test,${canvases.indexOf(canvas)}` };
        canvases.push(canvas);
        return canvas;
    },
};

const { ImageIcon, markerHitShape, markerIconExtentPx } = await import('../dist/index.mjs');

// 画像アイコンはオブジェクトの同一性でキャッシュするので、テストごとに別の画像を使う。
const image = () => ({ width: 64, height: 64 });
const label = 'ABCD'; // 40px + アウトライン 2px × 2 = 44px

function draw(icon) {
    const bitmap = icon.toBitmapIcon();
    const ops = canvases.at(-1).ops;
    const at = (name) => ops.find((op) => op[0] === name);
    return { bitmap, drawImage: at('drawImage'), fillText: at('fillText') };
}

test('ラベルが無ければ従来どおり（正方形・指定どおりのアンカー・当たり判定は全体）', () => {
    const icon = new ImageIcon(image(), { anchor: { x: 0.5, y: 1 } });
    const { bitmap, drawImage, fillText } = draw(icon);
    assert.deepEqual(bitmap.size, { width: 48, height: 48 });
    assert.deepEqual(bitmap.anchor, { x: 0.5, y: 1 });
    assert.equal(bitmap.hitBounds, undefined);
    assert.deepEqual(drawImage.slice(2), [0, 0, 48, 48]);
    assert.equal(fillText, undefined);
    assert.deepEqual(markerIconExtentPx(icon), { width: 48, height: 48 });
});

test('既定（center center）は画像の中央に重ねる。画像より広ければ左右対称に広げる', () => {
    const { bitmap, drawImage, fillText } = draw(new ImageIcon(image(), { label }));
    // 44px + 余白 4.8px は 48px を少し超える（既定のピンと同じ規則）。
    assert.deepEqual(bitmap.size, { width: 49, height: 48 });
    assert.deepEqual(drawImage.slice(2), [0.5, 0, 48, 48]);
    assert.deepEqual(fillText.slice(1), [label, 24.5, 24]);
    assert.deepEqual(bitmap.anchor, { x: 0.5, y: 0.5 });
});

test('right はビットマップを右へだけ伸ばし、アンカーは画像の同じ点を指す', () => {
    const icon = new ImageIcon(image(), { label, labelPosition: 'right', anchor: { x: 0.5, y: 0.5 } });
    const { bitmap, drawImage, fillText } = draw(icon);
    assert.equal(bitmap.size.height, 48);
    assert.ok(bitmap.size.width > 48 + 44);
    assert.deepEqual(drawImage.slice(2), [0, 0, 48, 48]);
    assert.equal(bitmap.anchor.x * bitmap.size.width, 24);
    assert.equal(bitmap.anchor.y, 0.5);
    // 画像の右端から gap（max(2, 48 × 0.05) = 2.4px）空けて、ラベルの左端が来る。
    assert.equal(fillText[2], 48 + 2.4 + 22);
    assert.equal(fillText[3], 24);
    assert.deepEqual(icon.anchor, bitmap.anchor);
    // 吹き出しの位置も画像に対する指定のまま。
    assert.equal(icon.infoAnchor.x * bitmap.size.width, 24);
});

test('left は right の鏡像で、画像はラベルの幅だけ右へずれる', () => {
    const right = draw(new ImageIcon(image(), { label, labelPosition: 'right' }));
    const left = draw(new ImageIcon(image(), { label, labelPosition: 'left' }));
    assert.equal(left.bitmap.size.width, right.bitmap.size.width);
    const offset = left.drawImage[2];
    assert.ok(offset > 44 && offset <= left.bitmap.size.width - 48);
    assert.equal(left.bitmap.anchor.x * left.bitmap.size.width, offset + 24);
    // 外側の余白は ceil で丸めるので、1px までの差は許す。
    assert.ok(Math.abs(left.fillText[2] - (left.bitmap.size.width - right.fillText[2])) <= 1);
});

test('横に置いた top / bottom は画像の上端・下端に揃える', () => {
    const top = draw(new ImageIcon(image(), { label, labelPosition: 'right top' }));
    const bottom = draw(new ImageIcon(image(), { label, labelPosition: 'bottom right' }));
    const labelHeight = 18 + 2 * 2;
    assert.equal(top.fillText[3], labelHeight / 2);
    assert.equal(bottom.fillText[3], 48 - labelHeight / 2);
    assert.equal(top.bitmap.size.height, 48);
});

test('center top は画像の上に置き、ビットマップを上へ伸ばす', () => {
    const icon = new ImageIcon(image(), { label, labelPosition: 'top', anchor: { x: 0.5, y: 1 }, infoAnchor: { x: 0.5, y: 0 } });
    const { bitmap, drawImage } = draw(icon);
    const offsetY = drawImage[3];
    assert.ok(offsetY > 0);
    assert.equal(bitmap.size.height, offsetY + 48);
    assert.equal(bitmap.anchor.y, 1);
    assert.equal(icon.infoAnchor.y * bitmap.size.height, offsetY);
});

test('当たり判定と画面上の大きさは画像とラベルを合わせた範囲', () => {
    const icon = new ImageIcon(image(), { label, labelPosition: 'right top' });
    const { bitmap, fillText } = draw(icon);
    assert.deepEqual(bitmap.hitBounds, { left: 0, top: 0, right: (fillText[2] + 22) / bitmap.size.width, bottom: 1 });
    const shape = markerHitShape(bitmap);
    assert.equal(shape.width, fillText[2] + 22);
    assert.equal(shape.height, 48);
    assert.deepEqual(markerIconExtentPx(icon), bitmap.size);
});

test('ラベルと位置はハッシュと equals に載り、指定値は requestedAnchor で取れる', () => {
    const source = image();
    const plain = new ImageIcon(source);
    const right = new ImageIcon(source, { label, labelPosition: 'right' });
    const left = new ImageIcon(source, { label, labelPosition: 'left' });
    assert.equal(new Set([plain, right, left].map((i) => i.hashCode())).size, 3);
    assert.equal(new ImageIcon(source, { label: null }).hashCode(), plain.hashCode());
    assert.ok(right.equals(new ImageIcon(source, { label, labelPosition: 'right' })));
    assert.ok(!right.equals(left));
    assert.deepEqual(left.requestedAnchor, { x: 0.5, y: 0.5 });
    assert.notDeepEqual(left.anchor, left.requestedAnchor);
});
