// Web Mercator の適合テスト。
//
// 同じ `projection-vectors.txt` を android-sdk / ios-sdk も読む。3 つが同じ答えを
// 出すことを担保するのが目的で、ここが見ているのはこのプラットフォームの分だけ。
// 突き合わせは `scripts/projection-conformance.mjs` が 3 つの出力に対して行う。
//
// `zoom-golden.txt` とは役割が違う。あちらは移行前の値の記録（既知の不具合込み）。
// こちらは現在の実装どうしが一致しているかを見る。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebMercator } from '../dist/index.mjs';

const here = import.meta.url;
const vectorsPath = fileURLToPath(new URL('./resources/projection-vectors.txt', here));
const actualPath = fileURLToPath(new URL('./resources/projection-actual.web.txt', here));
const expectedPath = fileURLToPath(new URL('./resources/projection-expected.txt', here));

/**
 * 桁を固定する。
 *
 * 言語ごとの既定の数値表記は揃わない（Kotlin は 1.49E7、Swift と JS は
 * 14931511.3）。f64 のノイズより粗く、実装差より細かい桁で切る。
 */
const fixed = (value) => {
    if (!Number.isFinite(value)) return value > 0 ? 'inf' : Number.isNaN(value) ? 'nan' : '-inf';
    return value.toFixed(6);
};

function runVectors() {
    const lines = readFileSync(vectorsPath, 'utf8').split('\n');
    const out = [];
    for (const line of lines) {
        const row = line.trim();
        if (!row || row.startsWith('#')) continue;
        const [op, a, b] = row.split('|');
        if (op === 'project') {
            const p = WebMercator.project({ latitude: +a, longitude: +b, altitude: null });
            out.push(`project|${a}|${b}|${fixed(p.x)}|${fixed(p.y)}`);
        } else if (op === 'unproject') {
            const g = WebMercator.unproject({ x: +a, y: +b });
            out.push(`unproject|${a}|${b}|${fixed(g.latitude)}|${fixed(g.longitude)}`);
        } else {
            throw new Error(`未知の演算: ${op}`);
        }
    }
    return out.join('\n') + '\n';
}

describe('WebMercator conformance', () => {
    it('ベクタを 1 行残らず処理できる', () => {
        const actual = runVectors();
        // 突き合わせスクリプトが読む。テストの副産物ではなく、これが成果物。
        writeFileSync(actualPath, actual);
        const rows = actual.trimEnd().split('\n');
        assert.ok(rows.length > 0, 'ベクタが 1 行も処理されていない');
        for (const row of rows) {
            assert.equal(row.split('|').length, 5, `列数が合わない: ${row}`);
        }
    });

    // 正本が決まるまでは存在しない。3 プラットフォームの差を潰してから凍結する。
    it('正本があれば完全一致する', { skip: !existsSync(expectedPath) }, () => {
        assert.equal(runVectors(), readFileSync(expectedPath, 'utf8'));
    });
});
