// geocell の適合テスト。
//
// 同じ `geocell-vectors.txt` を android-sdk / ios-sdk も読む。3 つが同じセルを
// 名指すことを担保するのが目的で、ここが見ているのはこのプラットフォームの分だけ。
//
// `ProjectionConformance.test.mjs` と同じ作りだが、**なぜ文字列で比べるか**が違う。
// 投影は 3 つとも double を返すので桁を丸めれば済む。セルの鍵はそうはいかない:
// Kotlin では Long、Swift では Int64、ここでは number で、number が整数を正確に
// 持てるのは 2^53 まで、ビット演算にいたっては int32 に丸められる。数値をそのまま
// 突き合わせても、実装が食い違っているのか表現が違うだけなのか区別できない。
// 0123456789abcdef の文字列にすれば、その問いは消える。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MarkerGrid } from '../dist/index.mjs';

const here = import.meta.url;
const vectorsPath = fileURLToPath(new URL('./resources/geocell-vectors.txt', here));
const actualPath = fileURLToPath(new URL('./resources/geocell-actual.web.txt', here));
const expectedPath = fileURLToPath(new URL('./resources/geocell-expected.txt', here));

function runVectors() {
    let out = '';
    for (const line of readFileSync(vectorsPath, 'utf8').split('\n')) {
        const row = line.trim();
        if (row === '' || row.startsWith('#')) continue;
        const parts = row.split('|');
        switch (parts[0]) {
            case 'geocell': {
                const text = MarkerGrid.geocell(Number(parts[1]), Number(parts[2]), Number(parts[3]));
                out += `geocell|${parts[1]}|${parts[2]}|${parts[3]}|${text}\n`;
                break;
            }
            case 'level': {
                const level = MarkerGrid.levelForSeparation(Number(parts[1]));
                out += `level|${parts[1]}|${level === null ? 'none' : level}\n`;
                break;
            }
            case 'cell': {
                const level = Number(parts[3]);
                const lat = MarkerGrid.latCell(Number(parts[1]), level);
                const lon = MarkerGrid.lonCell(Number(parts[2]), level);
                out += `cell|${parts[1]}|${parts[2]}|${parts[3]}|${lat},${lon}\n`;
                break;
            }
            case 'qlevel': {
                out += `qlevel|${parts[1]}|${parts[2]}|${MarkerGrid.queryLevel(Number(parts[1]), Number(parts[2]))}\n`;
                break;
            }
            case 'colwalk': {
                const span = MarkerGrid.eastwardSpan(Number(parts[1]), Number(parts[2]));
                const { start, count } = MarkerGrid.columnWalk(Number(parts[1]), span, Number(parts[3]));
                out += `colwalk|${parts[1]}|${parts[2]}|${parts[3]}|${start},${count}\n`;
                break;
            }
            case 'morton': {
                const key = MarkerGrid.morton(Number(parts[1]), Number(parts[2]), Number(parts[3]));
                out += `morton|${parts[1]}|${parts[2]}|${parts[3]}|${key}\n`;
                break;
            }
            default:
                throw new Error(`未知の演算: ${parts[0]}`);
        }
    }
    return out;
}

describe('geocell conformance', () => {
    it('ベクタが最後まで走る', () => {
        const actual = runVectors();
        // 突き合わせに使う。テストの副産物ではなく、これが成果物。
        writeFileSync(actualPath, actual);
        assert.ok(actual.split('\n').filter(Boolean).length > 0, 'ベクタが 1 行も処理されていない');
    });

    it('正本と一致する', (t) => {
        if (!existsSync(expectedPath)) return t.skip('正本がまだない');
        assert.equal(runVectors(), readFileSync(expectedPath, 'utf8'));
    });

    // 深い段の答えは浅い段の答えを接頭辞に持つ。索引が階層として働く条件そのもので、
    // これが崩れると「粗いセルのマーカーは連続している」という前提が外れる。
    it('深い段は浅い段を延ばしたものになる', () => {
        for (const [latitude, longitude] of [[35.681236, 139.767125], [-33.86882, 151.20929], [0, 0]]) {
            let previous = '';
            for (let characters = 1; characters <= 10; characters++) {
                const text = MarkerGrid.geocell(latitude, longitude, characters);
                assert.equal(text.length, characters);
                assert.ok(text.startsWith(previous), `${text} が ${previous} を接頭辞に持たない`);
                previous = text;
            }
        }
    });

    // JS 固有の落とし穴。鍵は 36 ビットあり、`<<` は int32 に丸める。
    // 算術で書いてあることを、ここで実際に確かめておく。
    it('鍵は 32 ビットを超えても壊れない', () => {
        const key = MarkerGrid.morton(262143, 524287, 18);
        assert.equal(key, 2 ** 37 - 1);
        assert.ok(Number.isSafeInteger(key));
        assert.equal(2 ** 40 | 0, 0); // ビット演算で書いていたら、こうなっていた
    });
});
