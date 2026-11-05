import type { GeoPoint, GeoRectBounds } from '../features';
import type { MarkerEntity } from './MarkerEntity';
import {
    cellSize,
    columnWalk,
    eastwardSpan,
    GRID_DEPTH,
    latCell,
    lonCell,
    morton,
    mortonKeyFor,
    queryLevel,
    rows,
    wrap,
} from './MarkerGrid';

/**
 * The spatial index {@link MarkerManager} answers from: the hierarchical grid of
 * {@link MarkerGrid}, kept up to date as markers come and go.
 *
 * android-sdk and ios-sdk have an index of the same name over the same cells.
 * It replaced a hex-cell registry and its kd-tree there; here it replaces the
 * same pair. That registry was built at a fixed zoom of 20, which puts a cell
 * at about 12 cm, so every marker landed in its own cell and the index grouped
 * nothing; and any change to the set of cells rebuilt the kd-tree over all of
 * them on the next query.
 *
 * ## Why this one updates in place, when the other two rebuild
 *
 * Those two hold each marker as one `Long` — its cell key above its position
 * in a snapshot — in one sorted primitive array, so a rebuild is an arithmetic
 * pass and a primitive sort, and they simply throw the index away on any
 * change. A JavaScript `number` has 53 bits and the pair needs 60, so
 * {@link GeoGridIndex} keeps a map of buckets per level instead. Rebuilding
 * that costs about 25 ms for 60,000 markers, and an app that swaps some
 * markers on every pan would pay it on the next tap each time — the stall
 * js-sdk-core#20 removed, back again.
 *
 * So the index remembers each marker's key at the bottom level, and moves only
 * the markers that change. A key at a coarser level is the bottom key with its
 * low bits dropped, so one number a marker is enough for every level.
 *
 * Nothing is filed until the first query asks: a map below the manager's
 * threshold never queries the index, and should not pay for keeping it.
 *
 * Positions are read from the entity at query time, and cells are chosen from
 * the position the marker had when it was last handed to {@link set}. A marker
 * moved in place without {@link set} is still found by a query that reaches
 * its old cell, as on the other two platforms.
 *
 * @internal
 */
export class MarkerGridIndex<ActualMarker> {
    /** Bottom-level key each marker was filed under, by id. */
    private readonly keys = new Map<string, number>();

    /** Whether the first query has filed the markers yet. Until then, changes are not tracked. */
    private active = false;

    /** Built levels: `level -> cellKey -> markers`. Built when first asked for. */
    private readonly levels = new Map<number, Map<number, Array<MarkerEntity<ActualMarker>>>>();

    /**
     * How many levels to keep built.
     *
     * A query level follows the size of the box, so clicks and tiles settle on
     * one or two, plus the level {@link nearest} walks. Every built level is
     * one more bucket to update per change.
     */
    private static readonly LEVEL_CACHE_MAX = 4;

    /**
     * The level {@link nearest} walks its rings at, and the reach that buys.
     *
     * Level 15 is 0.0055 degrees on a side, so 100 rings is about 45 km. The
     * same two numbers as android-sdk and ios-sdk.
     */
    private static readonly NEAREST_LEVEL = 15;

    /** Roughly 45 km of rings before giving up and scanning. */
    private static readonly MAX_NEAREST_RINGS = 100;

    /** `source` is the manager's own collection; the index holds no copy of it. */
    constructor(private readonly source: () => Iterable<MarkerEntity<ActualMarker>>) {}

    /** Whether the index has been built. */
    get isBuilt(): boolean {
        return this.active;
    }

    /** Roughly what the index costs: a key a marker, and a reference a marker per built level. */
    estimatedBytes(): number {
        return this.keys.size * (16 + 8 * this.levels.size);
    }

    /** Files a marker that was added, replaced, or moved. */
    set(entity: MarkerEntity<ActualMarker>): void {
        if (!this.active) return;
        const id = entity.state.id;
        const position = entity.state.position;
        const key = mortonKeyFor(position.latitude, position.longitude);
        const previous = this.keys.get(id);
        this.keys.set(id, key);

        for (const [level, cells] of this.levels) {
            const cellKey = MarkerGridIndex.cellKeyAt(key, level);
            if (previous !== undefined) {
                const previousCellKey = MarkerGridIndex.cellKeyAt(previous, level);
                if (previousCellKey === cellKey) {
                    // Same cell: the entity object may still have been replaced.
                    const bucket = cells.get(cellKey);
                    const at = bucket ? MarkerGridIndex.indexOf(bucket, id) : -1;
                    if (bucket && at >= 0) {
                        bucket[at] = entity;
                        continue;
                    }
                } else {
                    MarkerGridIndex.removeFrom(cells, previousCellKey, id);
                }
            }
            const bucket = cells.get(cellKey);
            if (bucket) bucket.push(entity);
            else cells.set(cellKey, [entity]);
        }
    }

    /** Forgets a marker. */
    remove(id: string): void {
        const key = this.keys.get(id);
        if (key === undefined) return;
        this.keys.delete(id);
        for (const [level, cells] of this.levels) {
            MarkerGridIndex.removeFrom(cells, MarkerGridIndex.cellKeyAt(key, level), id);
        }
    }

    clear(): void {
        this.keys.clear();
        this.levels.clear();
        this.active = false;
    }

    /** Files every marker the first time a query needs them. */
    private activate(): void {
        if (this.active) return;
        for (const entity of this.source()) {
            const position = entity.state.position;
            this.keys.set(entity.state.id, mortonKeyFor(position.latitude, position.longitude));
        }
        this.active = true;
    }

    /** Markers whose position falls inside `bounds`. */
    inBounds(bounds: GeoRectBounds): Array<MarkerEntity<ActualMarker>> {
        const southWest = bounds.southWest;
        const northEast = bounds.northEast;
        if (!southWest || !northEast) return [];

        // A box crossing the antimeridian has its east corner west of its west
        // one, and a padded box can run past ±180 outright. Both fold into a
        // single eastward sweep from the west edge.
        const lonSpan = eastwardSpan(southWest.longitude, northEast.longitude);
        const level = queryLevel(northEast.latitude - southWest.latitude, lonSpan);
        const rowFrom = latCell(southWest.latitude, level);
        const rowTo = latCell(northEast.latitude, level);
        if (rowTo < rowFrom) return [];
        const { start, count } = columnWalk(southWest.longitude, lonSpan, level);

        this.activate();
        const cells = this.cellsAt(level);
        const found: Array<MarkerEntity<ActualMarker>> = [];
        for (let row = rowFrom; row <= rowTo; row++) {
            for (let step = 0; step < count; step++) {
                const bucket = cells.get(morton(row, wrap(start + step, level), level));
                if (!bucket) continue;
                for (const entity of bucket) {
                    if (bounds.contains(entity.state.position)) found.push(entity);
                }
            }
        }
        return found;
    }

    /**
     * The marker nearest `position`, by squared degrees.
     *
     * Rings of cells are searched outward from the one holding the point. The
     * stopping rule is a distance, not a ring count: a ring is a square, so a
     * hit in one of its corners sits about 1.4 cells further out than a hit on
     * its edge, and stopping a fixed ring after the first hit returns the wrong
     * marker. Having finished ring r, everything still unsearched is at least r
     * cells away, so the search ends once that already exceeds the best
     * distance found.
     */
    nearest(position: GeoPoint): MarkerEntity<ActualMarker> | null {
        this.activate();
        if (this.keys.size === 0) return null;

        const level = MarkerGridIndex.NEAREST_LEVEL;
        const cells = this.cellsAt(level);
        const rowCount = rows(level);
        const centreRow = latCell(position.latitude, level);
        const centreColumn = lonCell(position.longitude, level);

        let best: MarkerEntity<ActualMarker> | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        const visit = (row: number, column: number): void => {
            // 行は極で打ち切る。折り返す経度と違い、緯度は 0..rows-1 の外に出たら
            // そこにセルは無い。
            if (row < 0 || row >= rowCount) return;
            const bucket = cells.get(morton(row, wrap(column, level), level));
            if (!bucket) return;
            for (const entity of bucket) {
                const distance = MarkerGridIndex.squaredDegrees(entity, position);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = entity;
                }
            }
        };

        for (let ring = 0; ring <= MarkerGridIndex.MAX_NEAREST_RINGS; ring++) {
            if (ring === 0) {
                visit(centreRow, centreColumn);
            } else {
                for (let offset = -ring; offset <= ring; offset++) {
                    visit(centreRow - ring, centreColumn + offset);
                    visit(centreRow + ring, centreColumn + offset);
                }
                for (let offset = -ring + 1; offset <= ring - 1; offset++) {
                    visit(centreRow + offset, centreColumn - ring);
                    visit(centreRow + offset, centreColumn + ring);
                }
            }
            // A ring is a square: the nearest unsearched point is `ring` cells
            // away on the shorter axis, which is latitude.
            const reach = ring * cellSize(level);
            if (best !== null && reach * reach >= bestDistance) break;
        }
        if (best !== null) return best;

        // Nothing within the rings searched: the set is sparse enough here that
        // scanning is cheaper than widening further.
        for (const entity of this.source()) {
            const distance = MarkerGridIndex.squaredDegrees(entity, position);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = entity;
            }
        }
        return best;
    }

    private cellsAt(level: number): Map<number, Array<MarkerEntity<ActualMarker>>> {
        const existing = this.levels.get(level);
        if (existing) return existing;

        const cells = new Map<number, Array<MarkerEntity<ActualMarker>>>();
        for (const entity of this.source()) {
            const key = this.keys.get(entity.state.id);
            if (key === undefined) continue;
            const cellKey = MarkerGridIndex.cellKeyAt(key, level);
            const bucket = cells.get(cellKey);
            if (bucket) bucket.push(entity);
            else cells.set(cellKey, [entity]);
        }
        this.levels.set(level, cells);
        while (this.levels.size > MarkerGridIndex.LEVEL_CACHE_MAX) {
            const oldest = this.levels.keys().next().value;
            if (oldest === undefined || oldest === level) break;
            this.levels.delete(oldest);
        }
        return cells;
    }

    /**
     * The bottom-level key with the low `2 * (GRID_DEPTH - level)` bits dropped,
     * which is the key of the cell `GRID_DEPTH - level` levels up. Division, not
     * a shift: the key is wider than the 32 bits JavaScript shifts operate on.
     */
    private static cellKeyAt(bottomKey: number, level: number): number {
        return Math.floor(bottomKey / 4 ** (GRID_DEPTH - level));
    }

    private static indexOf<ActualMarker>(bucket: Array<MarkerEntity<ActualMarker>>, id: string): number {
        for (let at = 0; at < bucket.length; at++) {
            if (bucket[at].state.id === id) return at;
        }
        return -1;
    }

    private static removeFrom<ActualMarker>(
        cells: Map<number, Array<MarkerEntity<ActualMarker>>>,
        cellKey: number,
        id: string,
    ): void {
        const bucket = cells.get(cellKey);
        if (!bucket) return;
        const at = MarkerGridIndex.indexOf(bucket, id);
        if (at < 0) return;
        // Order within a cell does not matter here: no caller picks a cell's
        // representative, as the tile renderer's thinned query does.
        bucket[at] = bucket[bucket.length - 1];
        bucket.pop();
        if (bucket.length === 0) cells.delete(cellKey);
    }

    private static squaredDegrees<ActualMarker>(entity: MarkerEntity<ActualMarker>, position: GeoPoint): number {
        const deltaLat = entity.state.position.latitude - position.latitude;
        const deltaLon = entity.state.position.longitude - position.longitude;
        return deltaLat * deltaLat + deltaLon * deltaLon;
    }
}
