import type { MapCapability } from './MapCapability';

/**
 * 要求に応えられなかった度合い。{@link MapCapabilityStatus} と対応するが、
 * こちらは「いま起きた 1 回の出来事」を表す。
 */
export type MapDiagnosticLevel =
    /** 出せない。 */
    | 'unsupported'
    /** 出るが別物になる。 */
    | 'degraded'
    /** 数値が近似になる。 */
    | 'approximated'
    /** 要求を捨てた。 */
    | 'ignored';

const PHRASE: Record<MapDiagnosticLevel, string> = {
    unsupported: 'is not supported by',
    degraded: 'is only partially supported by',
    approximated: 'is approximated by',
    ignored: 'cannot be changed on',
};

const CONSEQUENCE: Record<MapDiagnosticLevel, string> = {
    unsupported: 'the request is ignored.',
    degraded: 'the result differs from other providers.',
    approximated: 'values may differ slightly from other providers.',
    ignored: 'the setting is ignored.',
};

/** 報告の出力先。 */
export type MapDiagnosticsSink = (message: string) => void;

const reported = new Set<string>();

// eslint-disable-next-line no-console
let sink: MapDiagnosticsSink = (message) => console.warn(`MapConductor: ${message}`);

/**
 * プロバイダが応えられなかった要求を報告する。
 *
 * {@link MapUISettingsDiagnostics.warnIfRequested} を全 capability へ一般化したもの。
 * 元の実装が持っていた 2 つの正しい判断をそのまま引き継いでいる:
 *
 *  1. **アプリが実際にその機能を要求したときだけ報告する。** 起動時に非対応一覧を
 *     吐くとノイズになって読まれない。
 *  2. **provider + capability + level ごとに 1 回だけ。** 毎レンダーで呼ばれても
 *     コンソールが溢れない。
 *
 * 出力先は {@link MapDiagnostics.setSink} で差し替えられる。
 */
export const MapDiagnostics = {
    /** 出力先を差し替える。テストや独自ロガー向け。 */
    setSink(next: MapDiagnosticsSink): void {
        sink = next;
    },

    /**
     * 要求に応えられなかったことを 1 回だけ報告する。
     *
     * @param subject ログに出す名前。既定は capability そのもの。要求と設定名が
     *   食い違う場合（ジェスチャ設定など）に上書きする。
     * @returns 実際に報告したら true（同じ内容の 2 回目以降は false）。
     */
    report(
        capability: MapCapability,
        level: MapDiagnosticLevel,
        provider: string,
        reason: string,
        subject: string = capability,
    ): boolean {
        const key = `${provider}.${capability}.${level}`;
        if (reported.has(key)) return false;
        reported.add(key);
        sink(`${subject} ${PHRASE[level]} ${provider} (${reason}); ${CONSEQUENCE[level]}`);
        return true;
    },

    /**
     * `requested` が true のとき（＝アプリがその機能を実際に要求したとき）だけ報告する。
     *
     * 要求していない機能について警告しても行動につながらないので黙る。
     */
    reportIfRequested(
        requested: boolean,
        capability: MapCapability,
        level: MapDiagnosticLevel,
        provider: string,
        reason: string,
        subject: string = capability,
    ): boolean {
        if (!requested) return false;
        return MapDiagnostics.report(capability, level, provider, reason, subject);
    },

    /** テスト用フック — どの報告を済ませたかを忘れる。 */
    resetWarnings(): void {
        reported.clear();
    },
};
