import { TileProvider } from "./TileProvider";
import { TileRequest } from "./TileRequest";
import type { TileRenderRequest, TileRenderResponse } from "./WorkerProtocol";

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
    private readonly pendingRequests = new Map<number, (result: Uint8Array | null) => void>();
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
            const { id, result } = event.data;
            const resolve = this.pendingRequests.get(id);
            if (!resolve) return;
            this.pendingRequests.delete(id);
            // Wrap in a new Uint8Array in case the buffer was transferred (detached on worker side)
            resolve(result ? new Uint8Array(result) : null);
        };
    }

    /** Detach the renderer worker and fall back to main-thread rendering. */
    detachRenderer(): void {
        if (this.workerRenderer) {
            this.workerRenderer.onmessage = null;
            this.workerRenderer = null;
        }
        // Reject any pending requests that can no longer be fulfilled
        for (const resolve of this.pendingRequests.values()) {
            resolve(null);
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

    async handleFetch(routeId: string, request: TileRequest): Promise<Uint8Array | null> {
        if (this.workerRenderer) {
            return this.dispatchToWorker(routeId, request);
        }
        const provider = this.providers.get(routeId);
        if (!provider) return null;
        return provider.renderTile(request);
    }

    handleFetchDataUrl(routeId: string, request: TileRequest): string | null {
        const provider = this.providers.get(routeId) as
            | (TileProvider & { renderTileDataUrl?: (request: TileRequest) => string | null })
            | undefined;
        if (!provider?.renderTileDataUrl) return null;
        return provider.renderTileDataUrl(request);
    }

    private dispatchToWorker(routeId: string, request: TileRequest): Promise<Uint8Array | null> {
        const id = this.nextRequestId++;
        return new Promise<Uint8Array | null>((resolve) => {
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
                event.ports[0].postMessage({ result: null });
                return;
            }
            const [, routeId, z, x, y] = match;
            this.handleFetch(routeId, { x: +x, y: +y, z: +z }).then((result) => {
                if (result) {
                    event.ports[0].postMessage({ result }, [result.buffer]);
                } else {
                    event.ports[0].postMessage({ result: null });
                }
            });
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
