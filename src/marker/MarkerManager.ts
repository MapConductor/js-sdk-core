import { GeoPoint, GeoRectBounds } from "../features";
import { HexGeocell, HexGeocellImpl, HexCellRegistry, HexCell } from "../geocell";
import { Earth } from "../projection";
import { Spherical } from "../sperical";
import { MarkerEntity } from "./MarkerEntity";

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

    // Lazy-init 空間インデックス
    private cellRegistry: HexCellRegistry<ActualMarker> | null = null;

    private isDestroyed = false;

    constructor(geocell: HexGeocell, public readonly minMarkerCount: number = 2000) {
        this.geocell = geocell;
    }

    public lock(): void { /* no-op: JS is single-threaded */ }
    public unlock(): void { /* no-op: JS is single-threaded */ }

    openGetEntity(id: string): MarkerEntity<ActualMarker> | null {
        // （Kotlinの open fun を明示名で区別したい場合）
        return this.getEntity(id);
    }

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
            this.cellRegistry?.removePoint(removed);
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
            // 大きいデータセットでは空間インデックス使用
            const registry = this.ensureCellRegistry();
            const nearestCell = registry.findNearest(position);
            if (nearestCell) {
                const ids = registry.getEntryIDsByHexCell(nearestCell) ?? [];
                let best: MarkerEntity<ActualMarker> | null = null;
                let bestDistSq = Number.POSITIVE_INFINITY;

                for (const id of ids) {
                    const ent = this.entities.get(id);
                    if (!ent) continue;
                    const dx =
                        ent.state.position.latitude - position.latitude;
                    const dy =
                        ent.state.position.longitude - position.longitude;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestDistSq) {
                        best = ent;
                        bestDistSq = d2;
                    }
                }
                return best ?? this.bruteForceNearest(position);
            }
            // セルが無い場合はフォールバック
            return this.bruteForceNearest(position);
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

    public findByIdPrefix(prefix: string): HexCell[] {
        if (this.isDestroyed) return [];
        return this.cellRegistry?.findByIdPrefix(prefix) ?? [];
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
        this.cellRegistry?.setPoint(entity);
    }

    /** 空間操作が必要になった時だけ遅延初期化 */
    private ensureCellRegistry(): HexCellRegistry<ActualMarker> {
        if (!this.cellRegistry) {
            // Kotlin: HexCellRegistry(geocell = geocell, zoom = 20.0)
            this.cellRegistry = new HexCellRegistry<ActualMarker>({
                geocell: this.geocell,
                zoom: 20.0,
            });
            // 既存エンティティを再索引
            for (const entity of this.entities.values()) {
                this.cellRegistry.setPoint(entity);
            }
        }
        return this.cellRegistry;
    }

    public updateEntity(entity: MarkerEntity<ActualMarker>): void {
        // See registerEntity: post-destroy calls are a benign race, not a bug.
        if (this.isDestroyed) {
            console.warn('[MapConductor] MarkerManager.updateEntity called after destroy (ignored)');
            return;
        }
        this.entities.set(entity.state.id, entity);
        this.cellRegistry?.setPoint(entity);
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
            hasSpatialIndex: this.cellRegistry !== null,
            spatialIndexInitialized: this.cellRegistry !== null,
            estimatedMemoryKB: Math.floor(this.estimateMemoryUsage() / 1024),
        };
    }

    private estimateMemoryUsage(): number {
        // おおよその概算（バイト）
        const entityMapOverhead = this.entities.size * 64; // Mapエントリ + 文字列キー分
        const entityObjects = this.entities.size * 200; // エンティティ本体の概算
        const spatialIndexSize =
            this.cellRegistry !== null ? this.entities.size * 100 : 0; // レジストリ分の概算
        return entityMapOverhead + entityObjects + spatialIndexSize;
    }

    public clear(): void {
        if (this.isDestroyed) return;
        this.entities.clear();
        this.cellRegistry?.clear();
    }

    public findMarkersInBounds(
        bounds: GeoRectBounds
    ): Array<MarkerEntity<ActualMarker>> {
        if (this.isDestroyed) return [];
        if (bounds.isEmpty()) return [];

        if (this.entities.size > this.minMarkerCount) {
            const registry = this.ensureCellRegistry();
            const distance = Spherical.computeDistanceBetween(bounds.center!, bounds.northEast!);
            const hexCells = registry.findWithinRadiusWithDistance({
                position: bounds.center!,
                radius: distance,
            });
            const entryIDs = hexCells
                .flatMap((hc) => Array.from(registry.getEntryIDsByHexCell(hc.cell) ?? []));
            return entryIDs
                .map((id) => this.getEntity(id))
                .filter((entity): entity is MarkerEntity<ActualMarker> => entity != null);
        }

        // 現状は総当りでフィルタ
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
            this.cellRegistry?.clear();
            this.cellRegistry = null;
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
