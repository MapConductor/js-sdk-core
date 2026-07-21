import type { GeoPoint } from '../features';

/** Uniform lat/lng grid used to cull the candidate set per tile without scanning every marker. */
export class GeoGridIndex<T extends { position: GeoPoint }> {
    private readonly cells = new Map<string, T[]>();
    private static readonly CELL_DEG = 0.02;
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
        const cx = Math.floor(lng / GeoGridIndex.CELL_DEG);
        const cy = Math.floor(lat / GeoGridIndex.CELL_DEG);
        return `${cx}:${cy}`;
    }

    /** Items whose position falls within the given padded lat/lng bounds. */
    queryBounds(south: number, north: number, west: number, east: number): T[] {
        const cellDeg = GeoGridIndex.CELL_DEG;
        const cx0 = Math.floor(west / cellDeg);
        const cx1 = Math.floor(east / cellDeg);
        const cy0 = Math.floor(south / cellDeg);
        const cy1 = Math.floor(north / cellDeg);
        const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

        if (!Number.isFinite(cellCount) || cellCount > GeoGridIndex.MAX_CELLS_PER_QUERY) {
            return this.items.filter((item) =>
                item.position.latitude >= south && item.position.latitude <= north &&
                item.position.longitude >= west && item.position.longitude <= east,
            );
        }

        const out: T[] = [];
        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
                const bucket = this.cells.get(`${cx}:${cy}`);
                if (!bucket) continue;
                for (const item of bucket) {
                    const { latitude, longitude } = item.position;
                    if (latitude >= south && latitude <= north && longitude >= west && longitude <= east) {
                        out.push(item);
                    }
                }
            }
        }
        return out;
    }
}
