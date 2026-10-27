// 既定アイコンの labelPosition がビットマップの寸法とアンカーをどう変えるか。
//
// ラベルをピンの横や上に置くと、ビットマップはその側へだけ伸びる。そのとき
// アンカー（ピン先端）がビットマップの (0.5, 1) からずれるので、レンダラが
// 地図上の位置を取り違えないことをここで確かめる。DOM が無いので文字幅は近似。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ColorDefaultIcon, markerIconExtentPx } from '../dist/index.mjs';

const label = '信州大学';

function bitmapTipPx(icon) {
    const { anchor, size } = icon.toBitmapIcon();
    return { x: anchor.x * size.width, y: anchor.y * size.height, size };
}

test('既定（center center）は従来どおり左右対称でアンカーは (0.5, 1)', () => {
    const icon = new ColorDefaultIcon({ label });
    const { anchor, size } = icon.toBitmapIcon();
    assert.deepEqual(anchor, { x: 0.5, y: 1 });
    assert.equal(size.height, icon.iconSize);
    assert.deepEqual(icon.infoAnchor, { x: 0.5, y: 0 });
});

test('right center はビットマップを右へだけ伸ばし、ピン先端は左寄りになる', () => {
    const icon = new ColorDefaultIcon({ label, labelPosition: 'right center' });
    const tip = bitmapTipPx(icon);
    assert.equal(tip.size.height, icon.iconSize);
    assert.equal(tip.x, icon.iconSize / 2);
    assert.equal(tip.y, tip.size.height);
    assert.ok(tip.x < tip.size.width / 2);
    const svg = decodeURIComponent(icon.toBitmapIcon().url);
    const x = Number(/<text x="([\d.]+)"/.exec(svg)[1]);
    assert.ok(x > icon.iconSize, `label center ${x} should be right of the pin`);
});

test('横に置いた center は、ピンの上端と先端の真ん中に置く（頭の中心ではない）', () => {
    for (const labelPosition of ['right center', 'left center', 'right']) {
        const icon = new ColorDefaultIcon({ label, labelPosition });
        const svg = decodeURIComponent(icon.toBitmapIcon().url);
        const y = Number(/<text x="[\d.]+" y="([\d.]+)"/.exec(svg)[1]);
        // 48 px のピンは y 2〜43 に描かれる（中間は約 22.5）。頭の中心は 16.8。
        assert.ok(Math.abs(y - 22.5) <= 1, `${labelPosition}: label center y ${y}`);
        assert.equal(icon.toBitmapIcon().size.height, icon.iconSize);
    }
});

// ピン形は外接箱の中で 0.25 単位だけ右に寄っているので、1px までの差は許す。
test('left は right のほぼ鏡像', () => {
    const right = bitmapTipPx(new ColorDefaultIcon({ label, labelPosition: 'right' }));
    const left = bitmapTipPx(new ColorDefaultIcon({ label, labelPosition: 'left' }));
    assert.ok(Math.abs(left.size.width - right.size.width) <= 1);
    assert.ok(Math.abs(left.x - (left.size.width - right.x)) <= 1);
});

test('center top はピンの上に置き、ビットマップを上へ伸ばす', () => {
    const icon = new ColorDefaultIcon({ label, labelPosition: 'center top' });
    const tip = bitmapTipPx(icon);
    assert.ok(tip.size.height > icon.iconSize);
    assert.equal(tip.y, tip.size.height);
    // 吹き出しは引き続きピンの頭に付く。
    assert.equal(icon.infoAnchor.y * tip.size.height, tip.size.height - icon.iconSize);
});

test('キーワードの順序は問わない（CSS と同じ）', () => {
    const a = new ColorDefaultIcon({ label, labelPosition: 'right top' }).toBitmapIcon();
    const b = new ColorDefaultIcon({ label, labelPosition: 'top right' }).toBitmapIcon();
    assert.equal(a.url, b.url);
    assert.deepEqual(a.anchor, b.anchor);
});

test('labelPosition はハッシュと copy に載る', () => {
    const a = new ColorDefaultIcon({ label });
    const b = a.copy({ labelPosition: 'right center' });
    assert.notEqual(a.hashCode(), b.hashCode());
    assert.equal(b.copy({ fillColor: '#0000ff' }).labelPosition, 'right center');
});

test('copy は指定どおりの infoAnchor を引き継ぐ（変換後の値を二重に変換しない）', () => {
    const icon = new ColorDefaultIcon({ label, labelPosition: 'right center' });
    const copied = icon.copy({ fillColor: '#00ff00' });
    assert.deepEqual(copied.infoAnchor, icon.infoAnchor);
});

// 当たり判定と吹き出しはアイコンの実寸（ビットマップ）で矩形を取る。anchor は
// ビットマップに対する割合なので、ピン本体の正方形で取ると矩形がずれる。
test('markerIconExtentPx は既定アイコンのビットマップ寸法を返す', () => {
    const icon = new ColorDefaultIcon({ label, labelPosition: 'center top' });
    assert.deepEqual(markerIconExtentPx(icon), icon.toBitmapIcon().size);
    const plain = new ColorDefaultIcon();
    assert.deepEqual(markerIconExtentPx(plain), { width: plain.iconSize, height: plain.iconSize });
    assert.deepEqual(markerIconExtentPx(null), { width: 0, height: 0 });
});
