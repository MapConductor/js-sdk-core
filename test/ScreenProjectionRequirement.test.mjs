import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
    MapCapabilityStatus,
    MapDiagnostics,
    MutableMapServiceRegistry,
    ScreenProjectionRequirement,
} from '../dist/index.mjs';

/**
 * {@link ScreenProjectionRequirement} の意味論テスト。
 *
 * android-sdk の `ScreenProjectionRequirementTest`、ios-sdk の
 * `ScreenProjectionRequirementTests` と 1 対 1 で対応する。
 *
 * 守りたい不変条件は 1 つ:
 * **未宣言（`unknown`）を非対応と断定しない。**
 *
 * 宣言が無いのは「まだ宣言していない」か「地図の初期化途中」であって
 * 「使えない」ではない。ここで誤って機能を落とすと、宣言をまだ書いていない
 * プロバイダで InfoBubble やマーカーアニメーションが動かなくなる。
 */

let messages = [];

beforeEach(() => {
    messages = [];
    MapDiagnostics.setSink((message) => messages.push(message));
    MapDiagnostics.resetWarnings();
});

test('未宣言なら使える前提で通す', () => {
    const registry = new MutableMapServiceRegistry();
    assert.equal(ScreenProjectionRequirement.check(registry, 'Whatever', 'InfoBubble'), true);
    assert.equal(messages.length, 0, '未宣言で警告を出してはいけない');
});

test('supported なら通す', () => {
    const registry = new MutableMapServiceRegistry();
    registry.declare('screenProjectionSync', MapCapabilityStatus.supported);
    assert.equal(ScreenProjectionRequirement.check(registry, 'MapLibre', 'InfoBubble'), true);
    assert.equal(messages.length, 0);
});

test('unsupported なら落として理由を報告する', () => {
    const registry = new MutableMapServiceRegistry();
    registry.declareUnsupported(
        'screenProjectionSync',
        'Longdo runs on a WebView bridge with no synchronous project/unproject',
    );

    assert.equal(ScreenProjectionRequirement.check(registry, 'Longdo', 'InfoBubble'), false);

    assert.equal(messages.length, 1);
    assert.ok(messages[0].startsWith('InfoBubble'), '何が動かないのかを出す');
    assert.ok(messages[0].includes('WebView bridge'), '理由を出す');
    assert.ok(messages[0].includes('Longdo'), 'どのプロバイダかを出す');
});

test('報告は 1 回だけ（毎レンダーで呼ばれても溢れない）', () => {
    const registry = new MutableMapServiceRegistry();
    registry.declareUnsupported('screenProjectionSync', 'no sync');
    for (let i = 0; i < 100; i += 1) {
        ScreenProjectionRequirement.check(registry, 'Longdo', 'InfoBubble');
    }
    assert.equal(messages.length, 1);
});

test('degraded や approximated は落とさない', () => {
    // 「使えるが完全ではない」は動かす。落とすのは unsupported のときだけ。
    for (const status of [MapCapabilityStatus.degraded('partially'), MapCapabilityStatus.approximated('rounded')]) {
        MapDiagnostics.resetWarnings();
        messages = [];
        MapDiagnostics.setSink((message) => messages.push(message));
        const registry = new MutableMapServiceRegistry();
        registry.declare('screenProjectionSync', status);
        assert.equal(
            ScreenProjectionRequirement.check(registry, 'P', 'InfoBubble'),
            true,
            `${status.kind} で落としてはいけない`,
        );
        assert.equal(messages.length, 0);
    }
});
