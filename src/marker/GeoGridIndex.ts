import type { GeoPoint } from '../features';

/** Uniform lat/lng grid used to cull the candidate set per tile without scanning every marker. */
export class GeoGridIndex<T extends { position: GeoPoint }> {
    private readonly cells = new Map<string, T[]>();
    /**
     * About 450 m at Tokyo's latitude.
     *
     * Measured rather than picked: on 144k markers a tile-sized query costs
     * 0.06 ms at this size, 0.03 ms at 0.001 and 2.31 ms at the 0.02 this used
     * to be — the last no better than scanning, because a cell that size
     * returns five times the markers a tile needs. Matches android-sdk's and
     * ios-sdk's MarkerGridIndex.
     */
    private static readonly CELL_DEG = 0.005;

    /** Columns around the globe: the wrap the cell walk folds on. */
    private static readonly LON_CELLS = Math.round(360 / 0.005);
    // If a bounds query would need to scan more cells than this, brute-force
    // scanning `items` directly is comparably cheap and avoids pathological
    // cell-iteration costs for very large (near-global) bounds.
    private static readonly MAX_CELLS_PER_QUERY = 4000;

    constructor(private readonly items: ReadonlyArray<T>) {
        for (const item of items) {
            const key = this.cellKey(item.position.latitude, item.position.longitude);
            const bucket = this.cells.get(key);
            if (bucket) bucket.push(item);
            else this.cells.set(key, [item]);
        }
    }

    private cellKey(lat: number, lng: number): string {
        const cx = GeoGridIndex.wrapColumn(Math.floor(lng / GeoGridIndex.CELL_DEG));
        const cy = Math.floor(lat / GeoGridIndex.CELL_DEG);
        return `${cx}:${cy}`;
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
        const cellDeg = GeoGridIndex.CELL_DEG;
        // A full turn or more covers everything; anything else folds into a
        // single eastward sweep, whether the caller reversed the corners or ran
        // past ±180.
        const fullGlobe = east - west >= 360;
        const lonSpan = fullGlobe ? 360 : (((east - west) % 360) + 360) % 360;
        const cx0 = Math.floor(west / cellDeg);
        const cx1 = Math.floor(east / cellDeg) + (east < west ? GeoGridIndex.LON_CELLS : 0);
        const cy0 = Math.floor(south / cellDeg);
        const cy1 = Math.floor(north / cellDeg);
        const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

        const inside = (item: T): boolean =>
            item.position.latitude >= south &&
            item.position.latitude <= north &&
            (fullGlobe || GeoGridIndex.withinLongitude(item.position.longitude, west, lonSpan));

        if (!Number.isFinite(cellCount) || cellCount > GeoGridIndex.MAX_CELLS_PER_QUERY) {
            return this.items.filter(inside);
        }

        const out: T[] = [];
        for (let cx = cx0; cx <= cx1; cx++) {
            const wrapped = GeoGridIndex.wrapColumn(cx);
            for (let cy = cy0; cy <= cy1; cy++) {
                const bucket = this.cells.get(`${wrapped}:${cy}`);
                if (!bucket) continue;
                for (const item of bucket) {
                    if (inside(item)) out.push(item);
                }
            }
        }
        return out;
    }

    /** Folds a column index back onto the globe, so 180° and -180° share cells. */
    private static wrapColumn(cx: number): number {
        const min = -GeoGridIndex.LON_CELLS / 2;
        return min + (((cx - min) % GeoGridIndex.LON_CELLS) + GeoGridIndex.LON_CELLS) % GeoGridIndex.LON_CELLS;
    }

    /** Whether `lng` lies within `span` degrees east of `west`. */
    private static withinLongitude(lng: number, west: number, span: number): boolean {
        const offset = (((lng - west) % 360) + 360) % 360;
        return offset <= span;
    }
}
