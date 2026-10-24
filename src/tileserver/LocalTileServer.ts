import { TileProvider } from "./TileProvider";
import { TileOutcome, TileRenderFailedError, TRANSPARENT_TILE_PNG } from "./TileOutcome";
import { TileRequest } from "./TileRequest";
import type { TileRenderRequest, TileRenderResponse } from "./WorkerProtocol";
import { closeSWIcons } from '../marker/swIconBitmaps';

/**
 * Browser-side tile server implemented via a Service Worker interceptor.
 *
 * The Service Worker intercepts requests to `/__tiles/{routeId}/{tileSize}/{z}/{x}/{y}.png`
 * and renders registered SW-side tile data with OffscreenCanvas when possible.
 * If SW-side rendering is unavailable, it forwards requests back to the registered
 * TileProvider on the main thread.
 *
 * For CPU-intensive tile rendering, attach a Web Worker via `attachRenderer()` so that
 * `renderTile()` executes off the main thread. The worker should call
 * `createTileWorkerHandler()` from `@mapconductor/js-sdk-core`.
 */
export class LocalTileServer {
    private readonly providers = new Map<string, TileProvider>();
    private static instance: LocalTileServer | null = null;
    private static swRegistered = false;
    private workerRenderer: Worker | null = null;
    private readonly pendingRequests = new Map<number, (outcome: TileOutcome) => void>();
    private nextRequestId = 0;

    private constructor(public readonly baseUrl: string = "/__tiles") {}

    static startServer(): LocalTileServer {
        if (!LocalTileServer.instance) {
            LocalTileServer.instance = new LocalTileServer();
        }
        return LocalTileServer.instance;
    }

    /**
     * Attach a Web Worker that handles tile rendering via `createTileWorkerHandler()`.
     * When attached, `handleFetch()` delegates `renderTile()` to the worker thread
     * instead of running it on the main thread.
     */
    attachRenderer(worker: Worker): void {
        this.workerRenderer = worker;
        worker.onmessage = (event: MessageEvent<TileRenderResponse>) => {
            const { id, result, outcome } = event.data;
            const resolve = this.pendingRequests.get(id);
            if (!resolve) return;
            this.pendingRequests.delete(id);
            if (result) {
                // Wrap in a new Uint8Array in case the buffer was transferred
                // (detached on the worker side).
                resolve({ kind: 'tile', bytes: new Uint8Array(result) });
                return;
            }
            // A worker built against an older version sends no outcome, and
            // there null only ever meant "nothing to draw".
            resolve({ kind: outcome === 'tile' ? 'empty' : (outcome ?? 'empty') });
        };
    }

    /** Detach the renderer worker and fall back to main-thread rendering. */
    detachRenderer(): void {
        if (this.workerRenderer) {
            this.workerRenderer.onmessage = null;
            this.workerRenderer = null;
        }
        // Nothing will answer these now. They failed; they are not empty, so
        // the caller retries instead of caching a transparent tile.
        for (const resolve of this.pendingRequests.values()) {
            resolve({ kind: 'failed' });
        }
        this.pendingRequests.clear();
    }

    register(routeId: string, provider: TileProvider): void {
        this.providers.set(routeId, provider);
    }

    unregister(routeId: string): void {
        this.providers.delete(routeId);
        this.postToSW({ type: 'sw-unregister', routeId });
    }

    /**
     * Send provider data to the SW and await acknowledgment before returning.
     * This guarantees the SW can render tiles with OffscreenCanvas before the
     * caller adds the raster source (which triggers tile requests immediately).
     *
     * Falls back (resolves) after 500 ms if the SW does not respond — in that
     * case the postMessage fallback path in the SW will handle tile requests
     * using the provider already stored in `this.providers`.
     */
    sendSWRegisterAndWait(
        routeId: string,
        data: {
            items: { lat: number; lng: number; iconIndex: number }[];
            icons: { bitmap: ImageBitmap; anchor: { x: number; y: number }; size: { width: number; height: number } }[];
            zoomScales: number[];
            extraIconScale: number;
        },
    ): Promise<void> {
        if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
            // Nothing will be posted, so the payload's bitmaps have no reader.
            // Bailing out without this leaks one copy per distinct icon every
            // time the markers change on a page with no controlling SW.
            closeSWIcons(data.icons);
            return Promise.resolve();
        }
        const controller = navigator.serviceWorker.controller;
        return new Promise<void>((resolve) => {
            const channel = new MessageChannel();
            const fallback = setTimeout(resolve, 500);
            channel.port1.onmessage = () => {
                clearTimeout(fallback);
                resolve();
            };
            // Icon bitmaps are intentionally NOT transferred: ImageBitmap
            // supports structured cloning, so the SW gets an independent copy
            // while the main thread keeps its own (still needed for the
            // sync renderTileDataUrl()/Worker rendering paths).
            controller.postMessage(
                {
                    type: 'sw-register',
                    routeId,
                    items: data.items,
                    icons: data.icons,
                    zoomScales: data.zoomScales,
                    extraIconScale: data.extraIconScale,
                },
                [channel.port2],
            );
            // The clone above is synchronous, so the SW has its copy and the
            // payload's own bitmaps can go. Doing it here rather than at the
            // 14 provider call sites keeps `await server.sendSWRegisterAndWait(
            // id, await renderer.toSWData())` a complete, leak-free handover.
            closeSWIcons(data.icons);
        });
    }

    private postToSW(msg: object): void {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage(msg);
        }
    }

    urlTemplate({
        routeId,
        tileSize,
        cacheKey,
    }: {
        routeId: string;
        tileSize: number;
        cacheKey?: string;
    }): string {
        const base = `${this.baseUrl}/${routeId}/${tileSize}`;
        if (cacheKey) {
            return `${base}/${cacheKey}/{z}/{x}/{y}.png`;
        }
        return `${base}/{z}/{x}/{y}.png`;
    }

    /**
     * The bytes of one tile, or null when there are none.
     *
     * Null is two different things — nothing to draw, and a render that
     * failed — and callers that can tell a map library "ask again" should use
     * {@link handleFetchOutcome} or {@link fetchTileOrThrow} instead.
     */
    async handleFetch(routeId: string, request: TileRequest): Promise<Uint8Array | null> {
        const outcome = await this.handleFetchOutcome(routeId, request);
        return outcome.kind === 'tile' ? outcome.bytes : null;
    }

    /**
     * One tile, said precisely: drawn, empty, failed, or no such route.
     *
     * A provider says "empty" by returning null and "failed" by throwing. The
     * two must not be answered the same way: a transparent tile is cacheable
     * and correct for an empty spot, and a lie for a failure — it paints a
     * hole the library keeps, with the neighbouring tiles' overhang cut off at
     * its edge.
     */
    async handleFetchOutcome(routeId: string, request: TileRequest): Promise<TileOutcome> {
        if (this.workerRenderer) {
            return this.dispatchToWorker(routeId, request);
        }
        const provider = this.providers.get(routeId);
        if (!provider) return { kind: 'notFound' };
        let bytes: Uint8Array | null;
        try {
            bytes = await Promise.resolve(provider.renderTile(request));
        } catch (error) {
            console.warn('[LocalTileServer] renderTile threw for', routeId, request, error);
            return { kind: 'failed' };
        }
        return bytes ? { kind: 'tile', bytes } : { kind: 'empty' };
    }

    /**
     * Tile bytes for a map library that has no way to express "empty": an
     * empty spot comes back as a transparent tile, and a failure throws, which
     * every library reads as a load it may retry.
     */
    async fetchTileOrThrow(routeId: string, request: TileRequest): Promise<Uint8Array> {
        const outcome = await this.handleFetchOutcome(routeId, request);
        switch (outcome.kind) {
            case 'tile':
                return outcome.bytes;
            case 'empty':
            case 'notFound':
                return TRANSPARENT_TILE_PNG;
            case 'failed':
                throw new TileRenderFailedError(routeId, request);
        }
    }

    handleFetchDataUrl(routeId: string, request: TileRequest): string | null {
        const provider = this.providers.get(routeId) as
            | (TileProvider & { renderTileDataUrl?: (request: TileRequest) => string | null })
            | undefined;
        if (!provider?.renderTileDataUrl) return null;
        return provider.renderTileDataUrl(request);
    }

    private dispatchToWorker(routeId: string, request: TileRequest): Promise<TileOutcome> {
        const id = this.nextRequestId++;
        return new Promise<TileOutcome>((resolve) => {
            this.pendingRequests.set(id, resolve);
            const msg: TileRenderRequest = { type: 'render', id, routeId, request };
            this.workerRenderer!.postMessage(msg);
        });
    }

    /**
     * Register a Service Worker that intercepts `/__tiles/` requests and routes them
     * to `handleFetch()` on the main thread.
     *
     * Call once at app startup, before the map is rendered. The page URL template
     * returned by `urlTemplate()` will then be resolvable by the browser.
     *
     * @param swPath Path to the tile service worker script (default: `/tile-sw.js`)
     */
    startServiceWorker(swPath: string = '/tile-sw.js'): void {
        if (!LocalTileServer.isServiceWorkerSupported()) return;
        if (LocalTileServer.swRegistered) return;
        LocalTileServer.swRegistered = true;

        navigator.serviceWorker.register(swPath).catch((err) => {
            console.error('[LocalTileServer] SW registration failed:', err);
        });

        navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
            const { type, pathname } = event.data as { type: string; pathname: string };
            if (type !== 'tile-request') return;

            // pathname: /__tiles/{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}.png
            const match = pathname.match(
                /^\/__tiles\/([^/]+)\/\d+\/(?:[^/]+\/)?(\d+)\/(\d+)\/(\d+)\.png$/,
            );
            if (!match) {
                event.ports[0].postMessage({ result: null, outcome: 'notFound' });
                return;
            }
            const [, routeId, z, x, y] = match;
            this.handleFetchOutcome(routeId, { x: +x, y: +y, z: +z }).then(
                (outcome) => {
                    if (outcome.kind === 'tile') {
                        // Copy before transferring: providers may cache and reuse
                        // the returned bytes (e.g. HeatmapTileRenderer's LRU and
                        // its shared transparent tile), so transferring their
                        // buffer would detach it and break subsequent responses.
                        const bytes = new Uint8Array(outcome.bytes);
                        event.ports[0].postMessage({ result: bytes, outcome: 'tile' }, [bytes.buffer]);
                        return;
                    }
                    event.ports[0].postMessage({ result: null, outcome: outcome.kind });
                },
                // The worker died, the page is tearing down: the service worker
                // has to hear something, and what it must not hear is "empty".
                () => event.ports[0].postMessage({ result: null, outcome: 'failed' }),
            );
        });
    }

    hasProvider(routeId: string): boolean {
        return this.providers.has(routeId);
    }

    /**
     * Returns true when Service Workers are available in the current context.
     * SW requires a secure origin (HTTPS or localhost). On plain HTTP non-localhost
     * origins (e.g. a local IP like 192.168.x.x), SW is unavailable and tile
     * rendering must use a provider-specific fallback to avoid unresolvable tile URLs.
     */
    static isServiceWorkerSupported(): boolean {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return false;
        }
        if (typeof location === 'undefined') {
            return false;
        }

        if (location.protocol === 'https:') {
            return true;
        }

        if (location.protocol !== 'http:') {
            return false;
        }

        return (
            location.hostname === 'localhost' ||
            location.hostname === '127.0.0.1' ||
            location.hostname === '[::1]' ||
            location.hostname === '::1'
        );
    }

    /**
     * Resolves when the Service Worker is controlling the current page.
     * Returns immediately if the SW already controls the page.
     * Use this to avoid requesting tiles before the SW intercept is active.
     */
    waitForController(): Promise<void> {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return Promise.resolve();
        }
        if (navigator.serviceWorker.controller) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            const handler = () => {
                navigator.serviceWorker.removeEventListener('controllerchange', handler);
                resolve();
            };
            navigator.serviceWorker.addEventListener('controllerchange', handler);
        });
    }
}
