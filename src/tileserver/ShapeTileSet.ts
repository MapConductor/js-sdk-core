import { LocalTileServer, type SWCircle, type SWPolygon, type SWPolyline } from './LocalTileServer';
import { tilePixelRatio, tilePixelRatioSuffix } from './TilePixelRatio';
import type { TileRequest } from './TileRequest';
import type { GeoPoint } from '../features/GeoPoint';
import { encodePolyline } from '../polygon/EncodedPolyline';
import type { PolygonState } from '../polygon/PolygonState';
import type { PolylineState } from '../polyline/PolylineState';
import type { CircleState } from '../circle/CircleState';
import { effectiveCircleZIndex } from '../circle/CircleZIndex';
import { normalizeLngDegrees } from '../geometry/CircleGeometry';

const TILE_SIZE = 256;
/** In-place changes arriving within this window go to the worker as one message. */
const UPDATE_COALESCE_MS = 16;

/**
 * What a tiled shape needs from its state: an id, and its place in the draw
 * order (a null zIndex is resolved by the codec's `zIndexOf`).
 */
export interface ShapeTileState {
    readonly id: string;
    readonly zIndex: number | null;
}

/**
 * How one kind of shape (polygons, polylines) reaches the tile service worker.
 * @internal
 */
export interface ShapeTileCodec<S extends ShapeTileState, W> {
    /** Start of the route id, before a random part: `polygons`, `polylines`. */
    readonly routePrefix: string;
    /** The shape as the worker draws it. */
    encode(state: S): W;
    /** A shape that draws nothing: the slot of one taken out keeps the others' indices. */
    readonly empty: W;
    /** Its place in the draw order; `state.zIndex` (0 when null) if not given. */
    zIndexOf?(state: S): number;
    register(server: LocalTileServer, routeId: string, shapes: readonly W[]): Promise<boolean>;
    registerLarge?(server: LocalTileServer, routeId: string, count: number, encodeAt: (index: number) => W): Promise<boolean>;
    activate?(server: LocalTileServer, routeId: string, mask: Uint8Array): Promise<boolean>;
    revision?(state: S): number | undefined;
    update(server: LocalTileServer, routeId: string, updates: readonly { index: number; shape: W }[]): Promise<boolean>;
}

/**
 * The shapes of one map that are drawn as raster tiles, and their route on the
 * tile service worker. What `PolygonTileSet` and `PolylineTileSet` share: the
 * route, the version in the tile URL, coalescing in-place changes, the empty
 * slots of removed shapes, and answering main-thread tile reads.
 *
 * The URL template always carries the version (`cacheKey`). Every change that
 * reaches the worker bumps it and reports a new template, which is what makes
 * the map ask for its tiles again; the worker keeps the tiles the change did
 * not touch cached under a key without the version, so they come back undrawn.
 * @internal
 */
export class ShapeTileSet<S extends ShapeTileState, W> {
    readonly routeId: string;
    onTemplateChanged: ((template: string) => void) | null = null;

    private readonly server = LocalTileServer.startServer();
    private readonly pixelRatio = tilePixelRatio();
    private indexById = new Map<string, number>();
    private sourceStates: (S | null)[] = [];
    private circleSlots: WeakMap<S, number> | null = null;
    private circleRevisions: Float64Array | null = null;

    source(id: string): S | null {
        const index = this.indexById.get(id);
        return index === undefined ? null : this.sourceStates[index] ?? null;
    }

    visitSources(action: (state: S) => void): void {
        for (const state of this.sourceStates) if (state) action(state);
    }
    private version = 0;
    private registered = false;
    private registration = 0;
    private pending = new Map<string, S>();
    private pendingRemovals: number[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly codec: ShapeTileCodec<S, W>) {
        this.routeId = `${codec.routePrefix}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Registers `states` (replacing whatever was registered) and resolves to
     * the URL template of their tiles, or null when no service worker can
     * draw them.
     */
    async setShapes(states: readonly S[]): Promise<string | null> {
        if (!LocalTileServer.isServiceWorkerSupported()) return null;
        this.cancelPending();
        const registration = ++this.registration;
        // Draw order is list order in the worker: zIndex, then the order given.
        const zIndexOf = this.codec.zIndexOf ?? ((state: S) => state.zIndex ?? 0);
        let ordered = states;
        let previousZ = -Infinity;
        for (const state of states) {
            const z = zIndexOf(state);
            if (!Number.isFinite(z) || z < previousZ) {
                const zIndices = states.map(zIndexOf);
                ordered = states.map((_, index) => index)
                    .sort((a, b) => zIndices[a] - zIndices[b] || a - b)
                    .map(index => states[index]);
                break;
            }
            previousZ = z;
        }
        if (this.circleSlots && await this.reuseCircles(ordered, registration)) return this.template();
        if (registration !== this.registration) return null;
        const indexById = new Map<string, number>();
        ordered.forEach((state, index) => {
            indexById.set(state.id, index);
        });
        this.server.startServiceWorker('/tile-sw.js');
        await this.server.waitForController();
        if (registration !== this.registration) return null;
        const revision = this.codec.revision;
        const revisions = revision && ordered.length > 2_000 ? new Float64Array(ordered.length) : null;
        const encodeAt = (index: number) => {
            const state = ordered[index];
            if (revisions && revision) revisions[index] = revision(state) ?? NaN;
            return this.codec.encode(state);
        };
        const ok = this.codec.registerLarge && ordered.length > 2_000
            ? await this.codec.registerLarge(this.server, this.routeId, ordered.length, encodeAt)
            : await this.codec.register(this.server, this.routeId, ordered.map((_, index) => encodeAt(index)));
        if (!ok || registration !== this.registration) return null;
        // Some providers (Leaflet, Google Maps, deck.gl, ...) read `/__tiles/`
        // URLs from LocalTileServer on the main thread instead of loading them.
        // Answer them by fetching the same tile, which the service worker
        // intercepts and draws: the drawing stays off the main thread.
        this.server.register(this.routeId, { renderTile: (request) => this.fetchTile(request) });
        this.indexById = indexById;
        this.sourceStates = ordered.slice();
        if (revisions) {
            const slots = new WeakMap<S, number>();
            ordered.forEach((state, index) => slots.set(state, index));
            this.circleSlots = slots;
            this.circleRevisions = revisions;
        } else {
            this.circleSlots = null;
            this.circleRevisions = null;
        }
        this.registered = true;
        this.version++;
        return this.template();
    }

    has(id: string): boolean {
        return this.source(id) !== null;
    }

    private async reuseCircles(states: readonly S[], registration: number): Promise<boolean> {
        const { circleSlots, circleRevisions } = this;
        const { activate, revision } = this.codec;
        if (!circleSlots || !circleRevisions || !activate || !revision) return false;
        const mask = new Uint8Array(circleRevisions.length);
        let previous = -1;
        for (const state of states) {
            const index = circleSlots.get(state);
            if (index === undefined || index <= previous || this.indexById.get(state.id) !== index
                || revision(state) !== circleRevisions[index]) return false;
            mask[index] = 1;
            previous = index;
        }
        if (!(await activate(this.server, this.routeId, mask)) || registration !== this.registration) return false;
        for (let i = 0; i < mask.length; i++) if (!mask[i]) this.sourceStates[i] = null;
        for (const state of states) this.sourceStates[circleSlots.get(state)!] = state;
        this.version++;
        return true;
    }

    /** One shape changed in place (anything but its zIndex, which reorders the list). */
    update(state: S): void {
        if (!this.has(state.id)) return;
        if (this.circleRevisions) this.circleRevisions[this.indexById.get(state.id)!] = NaN;
        this.sourceStates[this.indexById.get(state.id)!] = state;
        this.pending.set(state.id, state);
        this.scheduleFlush();
    }

    /**
     * Takes one shape out of the tiles. Its slot in the worker's list is left
     * empty, so the others keep their indices and only the tiles it was in are
     * drawn again.
     */
    remove(id: string): void {
        const index = this.indexById.get(id);
        if (index === undefined) return;
        this.indexById.delete(id);
        this.sourceStates[index] = null;
        this.pending.delete(id);
        this.pendingRemovals.push(index);
        this.scheduleFlush();
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
        this.registration++;
        this.cancelPending();
        if (this.registered || this.codec.registerLarge) this.server.unregister(this.routeId);
        this.registered = false;
        this.indexById.clear();
        this.sourceStates = [];
        this.circleSlots = null;
        this.circleRevisions = null;
    }

    private scheduleFlush(): void {
        if (this.flushTimer == null) this.flushTimer = setTimeout(() => void this.flush(), UPDATE_COALESCE_MS);
    }

    private async fetchTile(request: TileRequest): Promise<Uint8Array | null> {
        const ratio = tilePixelRatioSuffix(request.pixelRatio);
        const response = await fetch(
            `${this.server.baseUrl}/${this.routeId}/${TILE_SIZE}/${this.version}/${request.z}/${request.x}/${request.y}${ratio}.png`,
        );
        // A 503 is a tile the worker could not draw now; throwing says "failed", not "empty".
        if (!response.ok) throw new Error(`${this.codec.routePrefix} tile ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }

    private async flush(): Promise<void> {
        this.flushTimer = null;
        const updates: { index: number; shape: W }[] = [];
        for (const state of this.pending.values()) {
            const index = this.indexById.get(state.id);
            if (index !== undefined) updates.push({ index, shape: this.codec.encode(state) });
        }
        for (const index of this.pendingRemovals) updates.push({ index, shape: this.codec.empty });
        this.pending.clear();
        this.pendingRemovals = [];
        if (updates.length === 0 || !this.registered) return;
        if (!(await this.codec.update(this.server, this.routeId, updates))) return;
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

/**
 * Which of a map's shapes are drawn as tiles, as of the last route: what
 * `PolygonTiler` and `PolylineTiler` share.
 * @internal
 */
export class ShapeTiler<S extends ShapeTileState, W> {
    onTemplate: ((template: string | null, tileSize: number) => void | Promise<void>) | null = null;

    private tiled = new Set<string>();
    private states: readonly S[] = [];

    constructor(
        private readonly tileSet: ShapeTileSet<S, W>,
        private readonly canTile: (state: S) => boolean,
        private readonly shouldUseTiles: (tileable: readonly S[]) => boolean,
    ) {
        tileSet.onTemplateChanged = (template) => void this.onTemplate?.(template, tileSet.tileSize);
    }

    async route(data: readonly S[]): Promise<ReadonlySet<string>> {
        const tileable = data.filter((state) => this.canTile(state));
        // Null without a service worker that can draw them: draw natively then.
        const template = this.shouldUseTiles(tileable) ? await this.tileSet.setShapes(tileable) : null;
        if (template == null) {
            this.tileSet.dispose();
            this.tiled = new Set();
            this.states = [];
        } else {
            this.tiled = new Set(tileable.map((state) => state.id));
            this.states = tileable;
        }
        await this.onTemplate?.(template, this.tileSet.tileSize);
        return this.tiled;
    }

    tiledStates(): readonly S[] {
        return this.states;
    }

    state(id: string): S | null { return this.tileSet.source(id); }
    visitStates(action: (state: S) => void): void { this.tileSet.visitSources(action); }

    isTiled(id: string): boolean {
        return this.tiled.has(id);
    }

    update(state: S): void {
        this.tileSet.update(state);
    }

    remove(id: string): void {
        if (!this.tiled.has(id)) return;
        const tiled = new Set(this.tiled);
        tiled.delete(id);
        this.tiled = tiled;
        this.states = this.states.filter((state) => state.id !== id);
        this.tileSet.remove(id);
    }

    async clear(): Promise<void> {
        this.tileSet.dispose();
        this.tiled = new Set();
        this.states = [];
        await this.onTemplate?.(null, this.tileSet.tileSize);
    }
}

/**
 * A ring or a path as the worker reads it: Encoded Polyline at 1e-6 degrees.
 * @internal
 */
export function encodeShapePath(points: readonly GeoPoint[]): string {
    const flat = new Array<number>(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        flat[i * 2] = points[i].latitude;
        flat[i * 2 + 1] = points[i].longitude;
    }
    return encodePolyline(flat, 6);
}

/**
 * The widest span of longitudes among `points`, in degrees. A shape spanning
 * half the world or more crosses the antimeridian, which a tile does not draw.
 * @internal
 */
export function longitudeSpan(points: readonly GeoPoint[]): number {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
        if (p.longitude < min) min = p.longitude;
        if (p.longitude > max) max = p.longitude;
    }
    return max - min;
}

/** @internal */
export const POLYGON_TILE_CODEC: ShapeTileCodec<PolygonState, SWPolygon> = {
    routePrefix: 'polygons',
    encode: (state) => ({
        rings: [state.points, ...state.holes].map(encodeShapePath),
        fill: state.fillColor,
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
    }),
    // A polygon with no rings: the worker keeps its slot and draws nothing there.
    empty: { rings: [], fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
    register: (server, routeId, shapes) => server.sendSWPolygonsAndWait(routeId, shapes),
    update: (server, routeId, updates) =>
        server.sendSWPolygonUpdates(routeId, updates.map(({ index, shape }) => ({ index, polygon: shape }))),
};

/** @internal */
export const POLYLINE_TILE_CODEC: ShapeTileCodec<PolylineState, SWPolyline> = {
    routePrefix: 'polylines',
    encode: (state) => ({
        path: encodeShapePath(state.points),
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
    }),
    // An empty path: the worker keeps its slot and draws nothing there.
    empty: { path: '', stroke: 'transparent', strokeWidth: 0 },
    register: (server, routeId, shapes) => server.sendSWPolylinesAndWait(routeId, shapes),
    update: (server, routeId, updates) =>
        server.sendSWPolylineUpdates(routeId, updates.map(({ index, shape }) => ({ index, polyline: shape }))),
};

/** @internal */
export const CIRCLE_TILE_CODEC: ShapeTileCodec<CircleState, SWCircle> = {
    routePrefix: 'circles',
    encode: (state) => ({
        latitude: state.center.latitude,
        // The worker draws round the centre as given in [-180, 180].
        longitude: normalizeLngDegrees(state.center.longitude),
        radiusMeters: state.radiusMeters,
        geodesic: state.geodesic,
        fill: state.fillColor,
        stroke: state.strokeColor,
        strokeWidth: state.strokeWidth,
    }),
    // A radius of 0: the worker keeps its slot and draws nothing there.
    empty: { latitude: 0, longitude: 0, radiusMeters: 0, geodesic: false, fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
    // The automatic zIndex of a circle without one, as the circle renderers and the tap use.
    zIndexOf: effectiveCircleZIndex,
    register: (server, routeId, shapes) => server.sendSWCirclesAndWait(routeId, shapes),
    registerLarge: (server, routeId, count, encodeAt) => server.sendSWCircleBlocks(routeId, count, encodeAt),
    activate: (server, routeId, mask) => server.activateSWCircles(routeId, mask),
    revision: (state) => state.revision,
    update: (server, routeId, updates) =>
        server.sendSWCircleUpdates(routeId, updates.map(({ index, shape }) => ({ index, circle: shape }))),
};
