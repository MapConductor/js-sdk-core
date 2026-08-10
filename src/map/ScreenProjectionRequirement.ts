import { MapCapability } from './MapCapability';
import { isKnownUnsupported } from './MapCapability';
import { MapDiagnostics } from './MapDiagnostics';
import type { MapServiceRegistry } from './MapServiceRegistry';

/**
 * 同期の座標変換を要求する機能が、それを使えないプロバイダ上で動くときに
 * 「黙って無反応」にならないようにするための入口。
 *
 * ## なぜ要るか
 *
 * `MapViewHolder.toScreenOffset` / `fromScreenOffsetSync` が null を返す理由は 2 つある。
 *
 *  1. その点が画面外・地表外（正常。毎フレーム起きる）
 *  2. **そのプロバイダが同期変換を持たない**（恒久的）
 *
 * 呼び出し側は null からこの 2 つを区別できない。2 の場合、機能が一切動かないのに
 * 何のログも出ないことになる。区別できるのは `screenProjectionSync` の宣言だけなので、
 * ここで見る。
 *
 * ## Unsupported は「機能が動かない」ときだけ宣言すること
 *
 * ホルダーの API が同期変換を持たないことと、機能が動かないことは**別**。
 * 独自経路でオーバーレイを配置できているなら `degraded` にすること。
 * `unsupported` にするとここが**動いているものを止める**。
 *
 * ## Unknown を非対応と断定しない
 *
 * 宣言が無い（`unknown`）＝「まだ宣言していない」であって「使えない」ではない。
 * 地図の初期化途中もここに入る。**報告するのは `unsupported` と明示されているときだけ**。
 */
export const ScreenProjectionRequirement = {
    /**
     * 同期投影が使えるか。使えないと**分かっている**ときだけ 1 回報告して `false` を返す。
     *
     * @param feature ログに出す機能名（"InfoBubble" など）。何が動かないのかを
     *   読み手に伝えるため、capability の id ではなくこちらを出す。
     * @returns 使える見込みがあれば `true`。`false` なら呼び出し側は機能を落とす。
     */
    check(registry: MapServiceRegistry, provider: string, feature: string): boolean {
        const capability: MapCapability = 'screenProjectionSync';
        const status = registry.capabilityStatus(capability);
        if (!isKnownUnsupported(status)) return true;
        MapDiagnostics.report(
            capability,
            'unsupported',
            provider,
            status.reason ?? 'this provider has no synchronous coordinate conversion',
            feature,
        );
        return false;
    },
};
