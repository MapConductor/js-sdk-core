import type { TileProvider } from './TileProvider';
import type { TileRenderRequest, TileRenderResponse } from './WorkerProtocol';

/**
 * Call this inside a Web Worker to handle tile rendering requests from LocalTileServer.
 *
 * Usage in your worker file:
 * ```ts
 * import { createTileWorkerHandler } from '@mapconductor/js-sdk-core';
 *
 * createTileWorkerHandler({
 *   'my-layer': {
 *     renderTile({ x, y, z }) {
 *       return generateTileBytes(x, y, z);
 *     },
 *   },
 * });
 * ```
 * Then on the main thread:
 * ```ts
 * const worker = new Worker(new URL('./my-layer.worker.ts', import.meta.url), { type: 'module' });
 * LocalTileServer.startServer().attachRenderer(worker);
 * ```
 */
export function createTileWorkerHandler(providers: Record<string, TileProvider>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = self as any;
    ctx.addEventListener('message', async (event: MessageEvent) => {
        const msg = event.data as TileRenderRequest;
        if (msg.type !== 'render') return;
        const { id, routeId, request } = msg;
        const provider = providers[routeId];
        if (!provider) {
            const response: TileRenderResponse = { type: 'render', id, result: null, outcome: 'notFound' };
            ctx.postMessage(response);
            return;
        }
        let result: Uint8Array | null;
        try {
            result = await Promise.resolve(provider.renderTile(request));
        } catch (error) {
            // Not an empty tile: the caller has to be able to ask again. Saying
            // "empty" here is what puts a permanent hole in the map.
            console.warn('[tile-worker] renderTile threw for', routeId, request, error);
            const response: TileRenderResponse = { type: 'render', id, result: null, outcome: 'failed' };
            ctx.postMessage(response);
            return;
        }
        if (result) {
            // Copy before transferring: providers may cache and reuse the
            // returned bytes, so transferring their buffer would detach it.
            const bytes = new Uint8Array(result);
            const response: TileRenderResponse = { type: 'render', id, result: bytes, outcome: 'tile' };
            ctx.postMessage(response, [bytes.buffer]);
        } else {
            const response: TileRenderResponse = { type: 'render', id, result: null, outcome: 'empty' };
            ctx.postMessage(response);
        }
    });
}
