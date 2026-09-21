// タイルの答えは 3 通りで、取り違えると地図に穴が残る。
//
// 「ここには何も無い」は本物の答えで、透明なタイルを返してよい。キャッシュされて
// 構わないし、データが変われば URL の version が動いて引き直される。
// 「いま描けなかった」は違う。これを透明なタイルで答えると、地図ライブラリは
// それを覚え、二度と要求しない。隣のタイルのはみ出し分だけが残るので、穴の縁で
// アイコンが半分に切れて見える。
//
// ここが見ているのは Service Worker の応答だけ。ios-sdk の LocalTileServer と
// android-sdk-core の LocalTileServerSemanticsTest が同じ 3 値を確かめている。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/tile-sw.js', import.meta.url), 'utf8');

/**
 * ワーカーを素の JS として読み込み、fetch のリスナーだけ取り出す。
 *
 * OffscreenCanvas は与えない。与えなければ `canRenderOffscreen()` が偽になり、
 * ページ（メインスレッド）へ回す経路に入る。空と失敗の区別が要るのはそこ。
 */
function loadWorker({ client }) {
    const listeners = new Map();
    // ワーカーが開いたポートは、閉じるまでイベントループを掴んだままになる
    // （node --test の子プロセスが終われなくなる）。作った端を控えておいて、
    // テストごとに閉じる。
    const channels = [];
    class TrackedMessageChannel extends MessageChannel {
        constructor() {
            super();
            channels.push(this);
        }
    }
    const self = {
        addEventListener: (type, fn) => listeners.set(type, fn),
        clients: {
            get: async () => client,
            matchAll: async () => (client ? [client] : []),
        },
        skipWaiting: () => {},
        registration: { waiting: null },
    };
    const context = {
        self,
        Response,
        URL,
        MessageChannel: TrackedMessageChannel,
        setTimeout,
        clearTimeout,
        console: { log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    return {
        onFetch: listeners.get('fetch'),
        close: () => {
            for (const channel of channels) {
                channel.port1.close();
                channel.port2.close();
            }
        },
    };
}

/** 1 枚分の fetch を投げ、返ってきた Response を待つ。 */
function fetchTile(onFetch, pathname = '/__tiles/route/256/10/1/2.png') {
    return new Promise((resolve, reject) => {
        onFetch({
            request: { url: `https://example.test${pathname}` },
            clientId: 'client-1',
            respondWith: (value) => Promise.resolve(value).then(resolve, reject),
        });
    });
}

/** `tile-request` に決まった答えを返すページ。 */
function pageAnswering(answer) {
    return {
        type: 'window',
        focused: true,
        postMessage: (message, transfer) => {
            const port = transfer[0];
            // ポートの相手側は SW 内の port1。MessageChannel は非同期なので、
            // そのまま postMessage すれば onmessage が発火する。
            port.postMessage(answer);
        },
    };
}

test('何も無いタイルは透明な絵として 200 で返る', async () => {
    const worker = loadWorker({ client: pageAnswering({ result: null, outcome: 'empty' }) });
    const response = await fetchTile(worker.onFetch);
    worker.close();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const body = new Uint8Array(await response.arrayBuffer());
    assert.ok(body.length > 0, '本体が空では地図が描けない');
    assert.deepEqual([...body.slice(0, 4)], [137, 80, 78, 71], 'PNG のシグネチャ');
});

test('描けなかったタイルは 503 で返り、キャッシュされない', async () => {
    const worker = loadWorker({ client: pageAnswering({ result: null, outcome: 'failed' }) });
    const response = await fetchTile(worker.onFetch);
    worker.close();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('retry-after'), '1');
});

test('答えるページが居ないときも、空ではなく失敗として返る', async () => {
    const worker = loadWorker({ client: null });
    const response = await fetchTile(worker.onFetch);
    worker.close();
    assert.equal(response.status, 503);
});

test('古いページ（outcome を送らない）は今まで通り空として扱う', async () => {
    const worker = loadWorker({ client: pageAnswering({ result: null }) });
    const response = await fetchTile(worker.onFetch);
    worker.close();
    assert.equal(response.status, 200);
});

test('描けたタイルはその中身が返る', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const worker = loadWorker({ client: pageAnswering({ result: png, outcome: 'tile' }) });
    const response = await fetchTile(worker.onFetch);
    worker.close();
    assert.equal(response.status, 200);
    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...body], [...png]);
});
