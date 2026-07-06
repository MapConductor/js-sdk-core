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
        const result = provider ? await Promise.resolve(provider.renderTile(request)) : null;
        if (result) {
            // Copy before transferring: providers may cache and reuse the
            // returned bytes, so transferring their buffer would detach it.
            const bytes = new Uint8Array(result);
            const response: TileRenderResponse = { type: 'render', id, result: bytes };
            ctx.postMessage(response, [bytes.buffer]);
        } else {
            const response: TileRenderResponse = { type: 'render', id, result: null };
            ctx.postMessage(response);
        }
    });
}
