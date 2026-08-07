import { DEFAULT_RASTER_LAYER_USER_AGENT, RasterLayerState } from "./RasterLayerState";
import { RasterLayerSource } from "./RasterLayerSource";

/** 「この宛先へのリクエストにはこのヘッダを載せる」という 1 件の規則。 */
export interface RasterHeaderRule {
    /** 適用先ホスト（小文字化済み）。 */
    readonly host: string;
    /** 適用先ポート。URL に明示が無ければ `null`。 */
    readonly port: number | null;
    /** 追加ヘッダ。 */
    readonly extraHeaders: Record<string, string>;
}

/** プロバイダがラスタタイル要求に何を載せられるか。 */
export interface RasterHeaderSupport {
    /** ログに出す表示名。 */
    readonly provider: string;
    /** `extraHeaders` をタイル要求に載せられるか。 */
    readonly extraHeaders: boolean;
}

/**
 * ラスタレイヤの `extraHeaders` を、**宛先ホスト単位**で管理する。
 *
 * ## 何のためにあるか
 *
 * 地図ライブラリのリクエスト書き換えフック（maplibre-gl / mapbox-gl / azure-maps の
 * `transformRequest`、ArcGIS の `esriConfig.request.interceptors`）は、**URL しか
 * 受け取らない**。どのラスタレイヤの要求なのかはフック側からは分からないので、
 * 「この URL ならこのヘッダ」という対応表を外に置いておく必要がある。
 *
 * 自分でタイルを取りに行くプロバイダ（Leaflet / OpenLayers / Cesium）は
 * `RasterLayerState` を直接持っているので、この表は使わない。
 *
 * ## なぜホスト単位か
 *
 * `transformRequest` は**地図 1 つにつき 1 つ**で、ベースマップのスタイル・
 * ベクタタイル・スプライトの取得もすべて通る。無条件にヘッダを載せると、
 * ラスタレイヤ用の認証ヘッダが**ベースマップの配信元にも送られる**。
 * 宛先ホストで絞れば、そのラスタタイルを配信しているサーバ宛だけに載る。
 *
 * android-sdk / ios-sdk の `RasterHeaderRuleSet` と同じ構造・同じ意味論。
 * ネイティブ側はフックが**プロセス全体に 1 つ**しかないためさらに事情が厳しいが、
 * 絞る理由そのものは同じ。
 *
 * ## userAgent がここに無い理由
 *
 * ブラウザでは User-Agent が fetch/XHR の forbidden header name で、指定しても
 * 捨てられる。載せられないものを表に持つと「登録できたのだから効くはず」と読めて
 * しまうので、web 側の規則は `extraHeaders` だけにしてある。
 * React Native では値がネイティブ SDK へ渡り、そちらで効く（[warnUnsupported] 参照）。
 */
export class RasterHeaderRuleSet {
    /** プロバイダ横断で共有する実体。 */
    static readonly shared = new RasterHeaderRuleSet();

    /**
     * 登録元 1 つ分の規則。
     *
     * 登録元（コントローラ）は可能なら弱参照で持つ。`removeRules` を呼び忘れても
     * 地図ごとリークさせないため。`WeakRef` が無い実行環境では強参照になるので、
     * その場合は `removeRules` が唯一の解放手段になる（コントローラの `destroy` が呼ぶ）。
     */
    private readonly entries: { owner: () => object | undefined; rules: RasterHeaderRule[] }[] = [];

    /** 規則が 1 件も無いか。 */
    get isEmpty(): boolean {
        this.purge();
        return this.entries.every((entry) => entry.rules.length === 0);
    }

    /** 登録元 1 つ分の規則を差し替える。 */
    setRules(rules: RasterHeaderRule[], owner: object): void {
        this.purge();
        this.removeRules(owner);
        if (rules.length > 0) {
            this.entries.push({ owner: weakOwner(owner), rules });
        }
    }

    /** 登録元 1 つ分の規則を外す（破棄時）。 */
    removeRules(owner: object): void {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].owner() === owner) this.entries.splice(i, 1);
        }
    }

    /**
     * [url] に載せるべき追加ヘッダ。該当が無ければ `null`。
     *
     * 同じホストに値の違うラスタレイヤが複数あるとき、フックは 1 つしかないので
     * どれか 1 つしか選べない。**後勝ちにはせず**、登録順で最初に一致した規則を使う
     * （順序が決まるので結果が再現する）。ここは android-sdk / ios-sdk と同じ挙動。
     */
    headersFor(url: string): Record<string, string> | null {
        const parsed = parseUrl(url);
        if (!parsed) return null;
        this.purge();
        for (const entry of this.entries) {
            for (const rule of entry.rules) {
                if (rule.host !== parsed.host) continue;
                if (rule.port != null && rule.port !== parsed.port) continue;
                return rule.extraHeaders;
            }
        }
        return null;
    }

    private purge(): void {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].owner() === undefined) this.entries.splice(i, 1);
        }
    }

    /** レイヤの状態から規則を組み立てる。ヘッダ指定が無い状態は規則を作らない。 */
    static makeRules(states: RasterLayerState[]): RasterHeaderRule[] {
        const rules: RasterHeaderRule[] = [];
        for (const state of states) {
            const extraHeaders = state.extraHeaders;
            if (!extraHeaders || Object.keys(extraHeaders).length === 0) continue;
            const parsed = parseUrl(templateUrlString(state.source));
            if (!parsed) continue;
            rules.push({ host: parsed.host, port: parsed.port, extraHeaders: { ...extraHeaders } });
        }
        return rules;
    }

    /**
     * 載せられない指定を、黙って無視せずに知らせる。
     *
     * ここで出さないと、利用者は「認証が通らない理由」を自分のサーバ側で探すことになる。
     * android-sdk / ios-sdk の `warnUnsupported` と同じ役割。
     *
     * `userAgent` は**プロバイダに関係なく web では常に非対応**。ブラウザが上書きを
     * 許さないためで、SDK 側で回避する方法は無い。ただしプロパティ自体は残してある:
     * React Native では同じコードがネイティブ SDK へ値を渡し、そちらでは実際に効く。
     * web と RN でコードを分けずに済ませるための意図的な残し方なので、
     * 「効かないなら消す」ではなく「効かない環境では知らせる」を選んでいる。
     */
    static warnUnsupported(support: RasterHeaderSupport, state: RasterLayerState): void {
        const ignored: string[] = [];
        const userAgent = state.userAgent.trim();
        if (userAgent.length > 0 && userAgent !== DEFAULT_RASTER_LAYER_USER_AGENT) {
            ignored.push("userAgent");
        }
        if (!support.extraHeaders && state.extraHeaders && Object.keys(state.extraHeaders).length > 0) {
            ignored.push("extraHeaders");
        }
        if (ignored.length === 0) return;

        // 同じレイヤで何度も出さない。更新経路は頻繁に走る。
        const key = `${support.provider}|${state.id}|${ignored.join(",")}`;
        if (warnedKeys.has(key)) return;
        warnedKeys.add(key);

        const reason = ignored.includes("userAgent")
            ? "browsers do not allow overriding User-Agent; the value is still passed through on React Native"
            : "this provider's map library does not expose a hook for adding request headers";
        console.warn(
            `MapConductor: ${support.provider} RasterLayer: ${ignored.join(" / ")} ` +
                `is ignored on the web (${reason}). id=${state.id}`,
        );
    }
}

const warnedKeys = new Set<string>();

/** `transformRequest` が返す形のうち、ここで触る部分だけ。 */
export interface RasterRequestParameters {
    url: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
}

export type RasterTransformRequest<ResourceType> = (
    url: string,
    resourceType: ResourceType,
) => RasterRequestParameters | undefined;

/**
 * GL 系ライブラリの `transformRequest` に差し込む関数を作る。
 *
 * maplibre-gl / mapbox-gl / azure-maps はいずれも `transformRequest` を**地図の生成時に
 * 1 つだけ**受け取る。利用者が `options.transformRequest` を渡している場合があるので、
 * 置き換えずに包む。包まないと、利用者が自分で足していた認証ヘッダが消える。
 *
 * 規則は毎回 [RasterHeaderRuleSet.shared] を引く。地図を作ったあとに追加された
 * ラスタレイヤにも効かせるためで、生成時のスナップショットを持つと最初の 1 枚しか
 * 効かない。
 */
export function withRasterHeaderTransform<ResourceType>(
    userTransform?: RasterTransformRequest<ResourceType> | null,
): RasterTransformRequest<ResourceType> {
    return (url, resourceType) => {
        const base = userTransform?.(url, resourceType);
        const headers = RasterHeaderRuleSet.shared.headersFor(url);
        if (!headers) return base;
        return { ...(base ?? { url }), headers: { ...(base?.headers ?? {}), ...headers } };
    };
}

const weakOwner = (owner: object): (() => object | undefined) => {
    if (typeof WeakRef === "function") {
        const ref = new WeakRef(owner);
        return () => ref.deref();
    }
    return () => owner;
};

/**
 * ホストとポートを取り出す。相対 URL も受け付ける。
 *
 * タイルのテンプレートは同一オリジンの相対パス（`/tiles/{z}/{x}/{y}.png`）でも
 * 書けるので、絶対 URL しか扱えないと**同一オリジンのタイルサーバだけ規則が
 * 作られない**という分かりにくい穴になる。文書の URL を基準に解決する。
 */
function parseUrl(raw: string): { host: string; port: number | null } | null {
    const base = typeof location !== "undefined" ? location.href : undefined;
    try {
        const url = new URL(raw, base);
        if (!url.hostname) return null;
        return {
            host: url.hostname.toLowerCase(),
            port: url.port === "" ? null : Number(url.port),
        };
    } catch {
        return null;
    }
}

/**
 * ソースから、ホストを取り出せる形の URL 文字列にする。
 *
 * `{z}/{x}/{y}` の差し込み記法が入ったままだと URL として解釈できないことがあるので、
 * 最初の `{` より前で切る。ホストが取れれば十分。
 */
function templateUrlString(source: RasterLayerSource): string {
    const raw =
        source.type === "UrlTemplate"
            ? source.template
            : source.type === "TileJson"
              ? source.url
              : source.serviceUrl;
    const brace = raw.indexOf("{");
    return brace < 0 ? raw : raw.slice(0, brace);
}
