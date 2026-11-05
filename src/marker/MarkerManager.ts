import { GeoPoint, GeoRectBounds } from "../features";
import { HexGeocell, HexGeocellImpl } from "../geocell";
import { Earth } from "../projection";
import { MarkerEntity } from "./MarkerEntity";
import { MarkerGridIndex } from "./MarkerGridIndex";

/**
 * Memory usage statistics for MarkerManager optimization
 */
export interface MarkerManagerStats {
    entityCount: number;
    hasSpatialIndex: boolean;
    spatialIndexInitialized: boolean;
    estimatedMemoryKB: number;
}

export class MarkerManager<ActualMarker> {
    protected readonly geocell: HexGeocell;

    // Kotlin: mutableMapOf<String, MarkerEntity<ActualMarker>>()
    private readonly entities = new Map<string, MarkerEntity<ActualMarker>>();

    /**
     * 空間インデックス。android-sdk / ios-sdk の `MarkerGridIndex` と同じ階層グリッド。
     *
     * 以前の六角セル + K-D 木は zoom 20 固定（セル 1 辺 約 12cm）で、マーカーがほぼ
     * 1 件ずつ別のセルに入り、何もまとめていなかった。しかもセルの集合が変わるたびに
     * 次の検索が全件の K-D 木を作り直していた。
     *
     * 足し引きはその場で索引に反映する（作り直さない）。理由は {@link MarkerGridIndex}。
     */
    private readonly gridIndex = new MarkerGridIndex<ActualMarker>(() => this.entities.values());

    private isDestroyed = false;

    constructor(geocell: HexGeocell, public readonly minMarkerCount: number = 2000) {
        this.geocell = geocell;
    }

    public lock(): void { /* no-op: JS is single-threaded */ }
    public unlock(): void { /* no-op: JS is single-threaded */ }

    public getEntity(id: string): MarkerEntity<ActualMarker> | null {
        if (this.isDestroyed) return null;
        return this.entities.get(id) ?? null;
    }

    public hasEntity(id: string): boolean {
        if (this.isDestroyed) return false;
        return this.entities.has(id);
    }

    public removeEntity(id: string): MarkerEntity<ActualMarker> | null {
        if (this.isDestroyed) return null;
        const removed = this.entities.get(id) ?? null;
        if (removed) {
            this.entities.delete(id);
            this.gridIndex.remove(id);
        }
        return removed;
    }

    public metersPerPixel({
        position,
        zoom,
        pixels,
        tileSize = 256,
    }: {
        position: GeoPoint;
        zoom: number;
        pixels: number;
        tileSize?: number;
    }): number {
        const pixelsAtZoom = tileSize * 2 ** zoom;
        // cos(toRadians(lat)) は lat * Math.PI/180
        return (
            (Earth.CIRCUMFERENCE_METERS / pixelsAtZoom) *
            Math.cos((position.latitude * Math.PI) / 180) *
            pixels
        );
    }

    public findNearest(position: GeoPoint): MarkerEntity<ActualMarker> | null {
        if (this.isDestroyed) return null;

        if (this.entities.size > this.minMarkerCount) {
            return this.gridIndex.nearest(position);
        }

        // 小規模は総当り
        return this.bruteForceNearest(position);
    }

    private bruteForceNearest(position: GeoPoint): MarkerEntity<ActualMarker> | null {
        let best: MarkerEntity<ActualMarker> | null = null;
        let bestDistSq = Number.POSITIVE_INFINITY;

        for (const ent of this.entities.values()) {
            const dx = ent.state.position.latitude - position.latitude;
            const dy = ent.state.position.longitude - position.longitude;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDistSq) {
                best = ent;
                bestDistSq = d2;
            }
        }
        return best;
    }

    public registerEntity(entity: MarkerEntity<ActualMarker>): void {
        // In-flight async work (e.g. a renderer.onAdd()/onChange() promise
        // resolving after a provider switch) can legitimately try to write
        // back into a manager that destroy() already cleared. destroy()
        // clears all state, so a post-destroy write is a harmless no-op on
        // an about-to-be-discarded manager — log instead of throwing, since
        // throwing here surfaces as an unhandled promise rejection.
        if (this.isDestroyed) {
            console.warn('[MapConductor] MarkerManager.registerEntity called after destroy (ignored)');
            return;
        }
        this.entities.set(entity.state.id, entity);
        this.gridIndex.set(entity);
    }

    public updateEntity(entity: MarkerEntity<ActualMarker>): void {
        // See registerEntity: post-destroy calls are a benign race, not a bug.
        if (this.isDestroyed) {
            console.warn('[MapConductor] MarkerManager.updateEntity called after destroy (ignored)');
            return;
        }
        this.entities.set(entity.state.id, entity);
        // 動いたマーカーは属するセルが変わる
        this.gridIndex.set(entity);
    }

    /**
     * ドラッグできるエンティティが 1 つでもあるか。
     *
     * `MarkerState` はその場で書き換えられる（`state.draggable = true`）ので、
     * 数を持ち回らず毎回数える。数万件でも数ミリ秒で、空間インデックスの再構築よりずっと軽い。
     */
    public hasDraggableEntity(): boolean {
        if (this.isDestroyed) return false;
        for (const entity of this.entities.values()) {
            if (entity.state.draggable) return true;
        }
        return false;
    }

    public allEntities(): Array<MarkerEntity<ActualMarker>> {
        if (this.isDestroyed) return [];
        return Array.from(this.entities.values());
    }

    /** メモリ統計（概算） */
    public getMemoryStats(): MarkerManagerStats {
        if (this.isDestroyed) {
            return { entityCount: 0, hasSpatialIndex: false, spatialIndexInitialized: false, estimatedMemoryKB: 0 };
        }
        return {
            entityCount: this.entities.size,
            hasSpatialIndex: true,
            spatialIndexInitialized: this.gridIndex.isBuilt,
            estimatedMemoryKB: Math.floor(this.estimateMemoryUsage() / 1024),
        };
    }

    private estimateMemoryUsage(): number {
        // おおよその概算（バイト）
        const entityMapOverhead = this.entities.size * 64; // Mapエントリ + 文字列キー分
        const entityObjects = this.entities.size * 200; // エンティティ本体の概算
        const spatialIndexSize = this.gridIndex.estimatedBytes();
        return entityMapOverhead + entityObjects + spatialIndexSize;
    }

    public clear(): void {
        if (this.isDestroyed) return;
        this.entities.clear();
        this.gridIndex.clear();
    }

    public findMarkersInBounds(
        bounds: GeoRectBounds
    ): Array<MarkerEntity<ActualMarker>> {
        if (this.isDestroyed) return [];
        if (bounds.isEmpty) return [];

        if (this.entities.size > this.minMarkerCount) {
            return this.gridIndex.inBounds(bounds);
        }

        // 小規模は総当りでフィルタ
        const out: Array<MarkerEntity<ActualMarker>> = [];
        for (const e of this.entities.values()) {
            if (bounds.contains(e.state.position)) {
                out.push(e);
            }
        }
        return out;
    }

    /** マッププロバイダ切替時などに正しく破棄する */
    public destroy(): void {
        if (!this.isDestroyed) {
            this.isDestroyed = true;
            this.entities.clear();
            this.gridIndex.clear();
        }
    }

    // companion object
    public static defaultManager<ActualMarker>(
        geocell?: HexGeocell | null,
        minMarkerCount: number = 2000
    ): MarkerManager<ActualMarker> {
        return new MarkerManager<ActualMarker>(
            geocell ?? HexGeocellImpl.defaultGeocell(),
            minMarkerCount
        );
    }
}
