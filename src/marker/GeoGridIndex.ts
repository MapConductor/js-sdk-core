import type { GeoPoint } from '../features';
import {
    columnWalk,
    eastwardSpan,
    latCell,
    levelForSeparation,
    lonCell,
    morton,
    queryLevel,
    wrap,
} from './MarkerGrid';

/**
 * A hierarchical lat/lng grid used to cull the candidate set per tile without
 * scanning every marker.
 *
 * The cells are the ones {@link MarkerGrid} describes, the same ones android-sdk
 * and ios-sdk index on. What differs is the storage. Those two keep one sorted
 * array of `(cellKey << 24) | position`, which works because a `Long` has 63
 * bits and the pair needs 60. A JavaScript `number` has 53, so the pair does
 * not fit — and its bitwise operators would truncate to 32 in any case. Here
 * the position lives in the bucket instead of in the key, which needs no packing
 * at all.
 *
 * The consequence is that a level is a map of its own rather than a prefix of a
 * shared array, so each one is built when first asked for. In practice a
 * renderer asks for one or two: the level its tiles fall on, and the level its
 * declutter separation asks for.
 */
export class GeoGridIndex<T extends { position: GeoPoint }> {
    /** Cells per level, built on demand. `level -> cellKey -> items`. */
    private readonly levels = new Map<number, Map<number, T[]>>();

    /**
     * How many levels to keep built.
     *
     * A renderer settles on one or two and stays there; holding more would keep
     * a second reference to every marker for a zoom the user has left.
     */
    private static readonly LEVEL_CACHE_MAX = 3;

    constructor(private readonly items: ReadonlyArray<T>) {}

    private cellsAt(level: number): Map<number, T[]> {
        const existing = this.levels.get(level);
        if (existing) return existing;

        const cells = new Map<number, T[]>();
        for (const item of this.items) {
            const key = morton(
                latCell(item.position.latitude, level),
                lonCell(item.position.longitude, level),
                level,
            );
            const bucket = cells.get(key);
            if (bucket) bucket.push(item);
            else cells.set(key, [item]);
        }
        this.levels.set(level, cells);
        while (this.levels.size > GeoGridIndex.LEVEL_CACHE_MAX) {
            const oldest = this.levels.keys().next().value;
            if (oldest === undefined) break;
            this.levels.delete(oldest);
        }
        return cells;
    }

    /**
     * Items whose position falls within the given padded lat/lng bounds.
     *
     * `west` and `east` may run past ±180 or come in reversed: both callers pad
     * a tile or a click by a few pixels, and near the antimeridian that padding
     * walks off the end of the coordinate range. Comparing those numbers
     * directly means a click at 179.99° never reaches a marker at -179.99°, and
     * a reversed box iterates no cells at all and quietly returns nothing.
     */
    queryBounds(south: number, north: number, west: number, east: number): T[] {
        const span = GeoGridIndex.spanOf(west, east);
        const inside = GeoGridIndex.insideTest<T>(south, north, west, span);
        if (north < south) return [];

        const level = queryLevel(north - south, span.lonSpan);
        const out: T[] = [];
        this.forEachCell(south, north, west, span.lonSpan, level, (bucket) => {
            for (const item of bucket) if (inside(item)) out.push(item);
        });
        return out;
    }

    /**
     * One item for each cell the bounds touch.
     *
     * The caller has said that items closer together than `minSeparationDegrees`
     * are interchangeable, so the index is free to hand back whichever of a
     * cell's items it likes — which is what lets it answer from its cells rather
     * than reading every item. The level comes from the separation: the coarsest
     * one whose cells are no wider than the caller asked for.
     *
     * ## Why the winner cannot depend on the bounds
     *
     * A cell's representative is the **last item in its bucket, always** — not
     * the last one that falls inside the bounds. The difference is what a map
     * made of tiles looks like at the seams.
     *
     * Tiles are rendered one at a time, each asking for its own box grown by the
     * icon overhang. A cell straddling the boundary is asked about twice, by two
     * different boxes. Choose the winner from what is inside the box and the two
     * tiles choose **different items:** one item gets its left half drawn on the
     * left tile and nothing on the right, so the icon is cut down the seam with
     * no error anywhere. Measured on ios-sdk with Tokyo's street trees, 74
     * markers at zoom 9 and 84 at zoom 10 were drawn by one tile and not by its
     * neighbour.
     *
     * Choosing without looking at the box removes the disagreement: an item
     * whose icon reaches the next tile is inside that tile's grown box too, so
     * that tile asks about the same cell and gets the same answer.
     *
     * A returned item may therefore lie just outside the bounds, by less than
     * one cell. The renderer clips it; what it must not do is filter the list
     * back down to the box, because that would put the disagreement back.
     *
     * Returns null when the index cannot help, meaning a separation finer than
     * the bottom level, which would thin more than was asked for. The caller
     * falls back to {@link queryBounds}.
     *
     * Mirrors `inBoundsThinned` in android-sdk and ios-sdk, where the index is
     * internal to the module. Kept off the public surface here for the same
     * reason: it is how the tile renderer talks to its index, not something an
     * app calls.
     *
     * @internal
     */
    queryBoundsThinned(
        south: number,
        north: number,
        west: number,
        east: number,
        minSeparationDegrees: number,
    ): T[] | null {
        const level = levelForSeparation(minSeparationDegrees);
        if (level === null) return null;
        if (north < south) return [];

        const out: T[] = [];
        this.forEachCell(south, north, west, eastwardSpan(west, east), level, (bucket) => {
            // The last one, to land on the same item the other two SDKs pick:
            // there the cell is a run in a sorted array ordered by position in
            // the snapshot, so its last entry is the one added last — which is
            // the end of this bucket.
            out.push(bucket[bucket.length - 1]);
        });
        return out;
    }

    /**
     * Walks the cells a box covers at `level`, folding columns onto the globe.
     *
     * The walk starts at the column holding `west` and runs eastward, which
     * covers a reversed or past-±180 box without a second loop.
     */
    private forEachCell(
        south: number,
        north: number,
        west: number,
        lonSpan: number,
        level: number,
        body: (bucket: T[]) => void,
    ): void {
        const cells = this.cellsAt(level);
        const rowFrom = latCell(south, level);
        const rowTo = latCell(north, level);
        const { start, count } = columnWalk(west, lonSpan, level);

        for (let row = rowFrom; row <= rowTo; row++) {
            for (let step = 0; step < count; step++) {
                const bucket = cells.get(morton(row, wrap(start + step, level), level));
                if (bucket) body(bucket);
            }
        }
    }

    private static spanOf(west: number, east: number): { fullGlobe: boolean; lonSpan: number } {
        // A full turn or more covers everything; anything else folds into a
        // single eastward sweep, whether the caller reversed the corners or ran
        // past ±180.
        return { fullGlobe: east - west >= 360, lonSpan: eastwardSpan(west, east) };
    }

    private static insideTest<T extends { position: GeoPoint }>(
        south: number,
        north: number,
        west: number,
        span: { fullGlobe: boolean; lonSpan: number },
    ): (item: T) => boolean {
        return (item: T): boolean =>
            item.position.latitude >= south &&
            item.position.latitude <= north &&
            (span.fullGlobe ||
                GeoGridIndex.withinLongitude(item.position.longitude, west, span.lonSpan));
    }

    /** Whether `lng` lies within `span` degrees east of `west`. */
    private static withinLongitude(lng: number, west: number, span: number): boolean {
        const offset = (((lng - west) % 360) + 360) % 360;
        return offset <= span;
    }
}
