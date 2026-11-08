import { LocalTileServer, type SWPolygon } from '../tileserver/LocalTileServer';
import { tilePixelRatio, tilePixelRatioSuffix } from '../tileserver/TilePixelRatio';
import type { TileRequest } from '../tileserver/TileRequest';
import type { GeoPoint } from '../features/GeoPoint';
import { encodePolyline } from './EncodedPolyline';
import type { PolygonState } from './PolygonState';

const TILE_SIZE = 256;
/** In-place changes arriving within this window go to the worker as one message. */
const UPDATE_COALESCE_MS = 16;

/**
 * The polygons of one map that are drawn as raster tiles, and their route on
 * the tile service worker.
 *
 * Provider-independent: a provider decides which polygons to tile
 * ({@link PolygonTilingOptions.shouldUseTiles}, {@link PolygonTileSet.canTile}),
 * hands them to {@link setPolygons}, and shows the returned URL template as a
 * raster layer. In-place changes go through {@link update}; each one ends in a
 * new template (the version in it is what makes the map ask again), reported
 * to {@link onTemplateChanged}. Tiles the change did not touch are still cached
 * by the worker and come back without being redrawn.
 *
 * Needs a service worker that can draw with OffscreenCanvas; {@link setPolygons}
 * resolves to null without one, and the provider should draw the polygons
 * itself instead.
 */
export class PolygonTileSet {
    readonly routeId = `polygons-${Math.random().toString(36).slice(2, 10)}`;
    onTemplateChanged: ((template: string) => void) | null = null;

    private readonly server = LocalTileServer.startServer();
    private readonly pixelRatio = tilePixelRatio();
    private indexById = new Map<string, number>();
    private version = 0;
    private registered = false;
    private pending = new Map<string, PolygonState>();
    private pendingRemovals: number[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Whether a polygon can be drawn in a tile. Geodesic edges are curves the
     * tile does not trace, and a ring spanning half the world or more crosses
     * the antimeridian; the map SDK draws both.
     */
    static canTile(state: PolygonState): boolean {
        if (state.geodesic || state.points.length < 3) return false;
        let min = Infinity;
        let max = -Infinity;
        for (const p of state.points) {
            if (p.longitude < min) min = p.longitude;
            if (p.longitude > max) max = p.longitude;
        }
        return max - min < 180;
    }

    static vertexCount(states: readonly PolygonState[]): number {
        let n = 0;
        for (const s of states) {
            n += s.points.length;
            for (const h of s.holes) n += h.length;
        }
        return n;
    }

    /**
     * Registers `states` (replacing whatever was registered) and resolves to
     * the URL template of their tiles, or null when no service worker can
     * draw them.
     */
    async setPolygons(states: readonly PolygonState[]): Promise<string | null> {
        if (!LocalTileServer.isServiceWorkerSupported()) return null;
        this.cancelPending();
        // Draw order is list order in the worker: zIndex, then the order given.
        const ordered = states.map((state, order) => ({ state, order }));
        ordered.sort((a, b) => a.state.zIndex - b.state.zIndex || a.order - b.order);
        const indexById = new Map<string, number>();
        const polygons = ordered.map(({ state }, index) => {
            indexById.set(state.id, index);
            return toSWPolygon(state);
        });
        this.server.startServiceWorker('/tile-sw.js');
        await this.server.waitForController();
        const ok = await this.server.sendSWPolygonsAndWait(this.routeId, polygons);
        if (!ok) return null;
        // Some providers (Leaflet, Google Maps, deck.gl, ...) read `/__tiles/`
        // URLs from LocalTileServer on the main thread instead of loading them.
        // Answer them by fetching the same tile, which the service worker
        // intercepts and draws: the drawing stays off the main thread.
        this.server.register(this.routeId, { renderTile: (request) => this.fetchTile(request) });
        this.indexById = indexById;
        this.registered = true;
        this.version++;
        return this.template();
    }

    has(id: string): boolean {
        return this.indexById.has(id);
    }

    /**
     * One polygon changed in place. A change of zIndex reorders the list and
     * needs {@link setPolygons} instead; everything else is applied here.
     */
    update(state: PolygonState): void {
        if (!this.indexById.has(state.id)) return;
        this.pending.set(state.id, state);
        if (this.flushTimer == null) this.flushTimer = setTimeout(() => void this.flush(), UPDATE_COALESCE_MS);
    }

    /**
     * Takes one polygon out of the tiles. Its slot in the worker's list is
     * left empty, so the others keep their indices and only the tiles it was
     * in are drawn again.
     */
    remove(id: string): void {
        const index = this.indexById.get(id);
        if (index === undefined) return;
        this.indexById.delete(id);
        this.pending.delete(id);
        this.pendingRemovals.push(index);
        if (this.flushTimer == null) this.flushTimer = setTimeout(() => void this.flush(), UPDATE_COALESCE_MS);
    }

    template(): string {
        return this.server.urlTemplate({
            routeId: this.routeId,
            tileSize: TILE_SIZE,
            cacheKey: String(this.version),
            pixelRatio: this.pixelRatio,
        });
    }

    get tileSize(): number {
        return TILE_SIZE;
    }

    dispose(): void {
        this.cancelPending();
        if (this.registered) this.server.unregister(this.routeId);
        this.registered = false;
        this.indexById.clear();
    }

    private async fetchTile(request: TileRequest): Promise<Uint8Array | null> {
        const ratio = tilePixelRatioSuffix(request.pixelRatio);
        const response = await fetch(
            `${this.server.baseUrl}/${this.routeId}/${TILE_SIZE}/${this.version}/${request.z}/${request.x}/${request.y}${ratio}.png`,
        );
        // A 503 is a tile the worker could not draw now; throwing says "failed", not "empty".
        if (!response.ok) throw new Error(`polygon tile ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }

    private async flush(): Promise<void> {
        this.flushTimer = null;
        const updates = [...this.pending.values()]
            .map((state) => ({ index: this.indexById.get(state.id), polygon: toSWPolygon(state) }))
            .filter((u): u is { index: number; polygon: SWPolygon } => u.index !== undefined);
        for (const index of this.pendingRemovals) updates.push({ index, polygon: EMPTY_SW_POLYGON });
        this.pending.clear();
        this.pendingRemovals = [];
        if (updates.length === 0 || !this.registered) return;
        if (!(await this.server.sendSWPolygonUpdates(this.routeId, updates))) return;
        this.version++;
        this.onTemplateChanged?.(this.template());
    }

    private cancelPending(): void {
        if (this.flushTimer != null) clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.pending.clear();
        this.pendingRemovals = [];
    }
}

/** A polygon with no rings: the worker keeps its slot and draws nothing there. */
const EMPTY_SW_POLYGON: SWPolygon = { rings: [], fill: 'transparent', stroke: 'transparent', strokeWidth: 0 };

function toSWPolygon(state: PolygonState): SWPolygon {
    return {
        rings: [state.points, ...state.holes].map(encodeRing),
        fill: state.fillColor,
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
    };
}

function encodeRing(ring: readonly GeoPoint[]): string {
    const flat = new Array<number>(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
        flat[i * 2] = ring[i].latitude;
        flat[i * 2 + 1] = ring[i].longitude;
    }
    return encodePolyline(flat, 6);
}
