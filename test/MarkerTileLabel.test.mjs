// タイル描画では、アイコン本体とラベルを別の画像に分けて描く（MarkerTileLabel）。
//
// - 本体はラベルの無いアイコンと同じ画像になる。ラベルだけ違うアイコンを大量に作っても、
//   デコードする本体は増えない。
// - ラベルの中心はアンカー点からのずれで持ち、焼き込みの配置と同じ場所に来る。
// - labelWritingMode が vertical-rl なら縦書き。寸法は 1 文字 1em に積んだもので、
//   画像は SVG の writing-mode で描く（Canvas には縦組みが無い）。
//
// DOM が無いので、canvas は描画命令を記録するだけの偽物で、文字幅は 1 文字 10px とする。
// android-sdk / ios-sdk のラベル配置と同じ。

import { test } from 'node:test';
import assert from 'node:assert/strict';

let canvasCount = 0;
globalThis.HTMLImageElement = class {};
globalThis.document = {
    createElement() {
        const context = new Proxy(
            { measureText: (text) => ({ width: [...text].length * 10 }) },
            { get: (target, key) => target[key] ?? (() => {}), set: () => true },
        );
        const id = canvasCount++;
        return { width: 0, height: 0, getContext: () => context, toDataURL: () => `data:image/png;test,${id}` };
    },
};

const { ImageIcon, ColorDefaultIcon } = await import('../dist/index.mjs');

const image = () => ({ width: 64, height: 64 });
const svgOf = (url) => decodeURIComponent(url.slice(url.indexOf(',') + 1));

test('本体はラベルの無いアイコンと同じ画像になる', () => {
    const source = image();
    const plain = new ImageIcon(source, { iconSize: 10 });
    const labelled = new ImageIcon(source, { iconSize: 10, label: 'イチョウ', labelPosition: 'bottom' });
    const parts = labelled.tileParts();
    assert.equal(parts.body.url, plain.toBitmapIcon().url);
    assert.deepEqual(parts.body.size, plain.toBitmapIcon().size);
    assert.ok(parts.label);
    assert.equal(plain.tileParts().label, null);
});

test('縦書きのラベルは 1 文字 1em に積んだ寸法で、本体の下に置く', () => {
    const icon = new ImageIcon(image(), {
        iconSize: 10,
        anchor: { x: 0.5, y: 0.5 },
        label: 'イチョウ',
        labelTextSize: 18,
        labelPosition: 'bottom',
        labelWritingMode: 'vertical-rl',
    });
    const { label } = icon.tileParts();
    // 列の幅は字の幅（10px）と 1em（18px）の大きい方、縁取り 2px × 2 を足す。
    assert.equal(label.width, 18 + 4);
    assert.equal(label.height, 4 * 18 + 4);
    // 中心は横はアンカーの真下、縦は画像の下端（アンカーから 5px）よりすき間ぶん下。
    assert.equal(label.centerOffsetX, 0);
    assert.ok(label.centerOffsetY - label.height / 2 >= 5, `top edge ${label.centerOffsetY - label.height / 2}`);
    assert.match(svgOf(label.url), /writing-mode="vertical-rl"/);
});

test('横書きのラベルは右に置き、SVG に writing-mode を付けない', () => {
    const icon = new ImageIcon(image(), { iconSize: 10, label: 'ABC', labelTextSize: 10, labelPosition: 'right' });
    const { label } = icon.tileParts();
    assert.equal(label.width, 30 + 4);
    assert.equal(label.height, 10 + 4);
    assert.ok(label.centerOffsetX - label.width / 2 >= 5);
    assert.doesNotMatch(svgOf(label.url), /writing-mode/);
});

test('縦書きのラベルを焼き込むと SVG になり、横書きは従来どおり canvas の画像のまま', () => {
    const vertical = new ImageIcon(image(), { label: 'ムクゲ', labelWritingMode: 'vertical-rl', labelPosition: 'top' });
    const url = vertical.toBitmapIcon().url;
    assert.ok(url.startsWith('data:image/svg+xml'));
    assert.match(svgOf(url), /writing-mode="vertical-rl"/);
    const horizontal = new ImageIcon(image(), { label: 'ムクゲ', labelPosition: 'top' });
    assert.ok(horizontal.toBitmapIcon().url.startsWith('data:image/png'));
});

test('書字方向は同一性に含まれる', () => {
    const source = image();
    const a = new ImageIcon(source, { label: 'ABC' });
    const b = new ImageIcon(source, { label: 'ABC', labelWritingMode: 'vertical-rl' });
    assert.notEqual(a.hashCode(), b.hashCode());
    assert.equal(a.equals(b), false);
});

test('既定のピンも本体とラベルに分かれ、本体にはラベルが入らない', () => {
    const icon = new ColorDefaultIcon({ label: 'ABC', labelPosition: 'right', labelWritingMode: 'vertical-rl' });
    const parts = icon.tileParts();
    assert.deepEqual(parts.body.anchor, { x: 0.5, y: 1 });
    assert.doesNotMatch(svgOf(parts.body.url), /<text/);
    assert.match(svgOf(parts.label.url), /writing-mode="vertical-rl"/);
    // 焼き込みにも縦書きで入る。
    assert.match(svgOf(icon.toBitmapIcon().url), /writing-mode="vertical-rl"/);
    assert.equal(icon.labelWritingMode, 'vertical-rl');
    assert.equal(icon.copy({}).labelWritingMode, 'vertical-rl');
});
