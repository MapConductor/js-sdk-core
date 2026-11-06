/**
 * URL で渡されたアイコン画像（`new ImageIcon(url)`）を読み込む。
 *
 * - 同じ URL は 1 回だけ読む。読み込み中に同じ URL が来たら、同じ読み込みを待つ。
 * - `crossOrigin = "anonymous"` で読む。CORS を許さないサーバの画像は失敗として扱う
 *   （そのまま描くと canvas が汚れて `toDataURL()` が投げる）。
 * - 読み終えた画像は LRU で持つ。後から同じ URL のアイコンを作ると、その場で読み終えた状態になる。
 * - 失敗も覚えておき、同じ URL を何度も取りに行かない。警告は URL ごとに 1 回。
 *
 * android-sdk / ios-sdk の `RemoteImageLoader` と同じ振る舞い。
 *
 * @internal
 */

/** 読み終えた画像。失敗は null。 */
export type RemoteImageResult = HTMLImageElement | null;

const MAX_SETTLED_ENTRIES = 256;

const settled = new Map<string, RemoteImageResult>();
const pending = new Map<string, Promise<RemoteImageResult>>();

/**
 * 読み終えていればその結果（失敗は null）、まだなら undefined。
 *
 * @internal
 */
export function peekRemoteImage(url: string): RemoteImageResult | undefined {
    if (!settled.has(url)) return undefined;
    const result = settled.get(url) ?? null;
    // LRU: 最近使用として末尾へ移動する。
    settled.delete(url);
    settled.set(url, result);
    return result;
}

/**
 * URL の画像を読む。読み終えていれば、すぐに解決する Promise を返す。決して reject しない。
 *
 * @internal
 */
export function loadRemoteImage(url: string): Promise<RemoteImageResult> {
    const done = peekRemoteImage(url);
    if (done !== undefined) return Promise.resolve(done);
    let promise = pending.get(url);
    if (!promise) {
        promise = decode(url).then(result => {
            pending.delete(url);
            remember(url, result);
            return result;
        });
        pending.set(url, promise);
    }
    return promise;
}

function remember(url: string, result: RemoteImageResult): void {
    settled.set(url, result);
    while (settled.size > MAX_SETTLED_ENTRIES) {
        const oldest = settled.keys().next().value;
        if (oldest === undefined) break;
        settled.delete(oldest);
    }
}

async function decode(url: string): Promise<RemoteImageResult> {
    if (typeof Image === "undefined") {
        console.warn(`[MapConductor] ImageIcon: cannot load ${url} without a DOM`);
        return null;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = url;
    try {
        await image.decode();
        return image;
    } catch {
        console.warn(`[MapConductor] ImageIcon: failed to load ${url} (CORS must allow it)`);
        return null;
    }
}

