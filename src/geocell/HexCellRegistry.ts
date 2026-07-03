import { HexCellWithDistance } from ".";
import { GeoPoint, createGeoPoint } from "../features";
import { MarkerEntity } from "../marker";
import { createHexCell, HexCell } from "./HexCell";
import { HexGeocell } from "./HexGeocell";
import { KDTree } from "./KDTree";

export class HexCellRegistry<ActualMarker> {

    private kdTree: KDTree | null = null;
    private readonly allCells = new Map<string, HexCell>();
    private readonly entryIDsByCell = new Map<string, Set<string>>();
    private readonly allEntries = new Map<string, string>(); // entityId -> cellId
    private needsRebuild = false;

    // JS/TS は単スレッド想定のためロックはダミー実装
    private readonly lock = {
        read: <T>(fn: () => T): T => fn(),
        write: <T>(fn: () => T): T => fn(),
    };

    private readonly geocell: HexGeocell;
    private readonly zoom: number;
    constructor(params: {
        geocell: HexGeocell,
        zoom: number,
    }) {
        this.geocell = params.geocell;
        this.zoom = params.zoom;
    }

    /** 対象エンティティが属する HexCell を（登録せず）計算して返す */
    public getCell(entity: MarkerEntity<ActualMarker>): HexCell {
        const coord = this.geocell.latLngToHexCoord({
            position: entity.state.position,
            zoom: this.zoom,
        });
        const centerLatLng = this.geocell.hexToLatLngCenter({
            coord,
            latitude: entity.state.position.latitude,
            zoom: this.zoom
        });
        const centerXY = this.geocell.projection.project(centerLatLng);
        const cellId = this.geocell.hexToCellId({
            coord,
            zoom: this.zoom,
        });
        return createHexCell({ coord, centerLatLng, centerXY, id: cellId });
    }

    /** 登録/更新して属する HexCell を返す */
    public setPoint(entity: MarkerEntity<ActualMarker>): HexCell {
        return this.lock.write(() => {
            const entityId = entity.state.id;

            // 古いセルから外す
            const oldCellId = this.allEntries.get(entityId);
            if (oldCellId) this.removeFromCell({
                cellId: oldCellId,
                entityId,
            });

            // 新しいセルへ
            const cell = this.getCell(entity);
            const cellId = cell.id;

            this.allCells.set(cellId, cell);
            this.allEntries.set(entityId, cellId);

            const set = this.entryIDsByCell.get(cellId) ?? new Set<string>();
            set.add(entityId);
            this.entryIDsByCell.set(cellId, set);

            this.markDirty();
            return cell;
        });
    }

    /** HexCell が存在するか */
    public contains(hexId: string): boolean {
        return this.allCells.has(hexId);
    }

    /** エンティティをレジストリから削除 */
    public removePoint(entity: MarkerEntity<ActualMarker>): boolean {
        return this.lock.write(() => {
            const entityId = entity.state.id;
            const cellId = this.allEntries.get(entityId);
            if (!cellId) return false;

            const removed = this.removeFromCell({
                cellId,
                entityId,
            });
            if (removed) {
                this.allEntries.delete(entityId);
                this.markDirty();
            }
            return removed;
        });
    }

    /** 特定セルからエンティティを外す */
    private removeFromCell(params: {
        cellId: string;
        entityId: string;
    }): boolean {
        const set = this.entryIDsByCell.get(params.cellId);
        if (!set) return false;
        const removed = set.delete(params.entityId);
        if (removed && set.size === 0) {
            this.allCells.delete(params.cellId);
            this.entryIDsByCell.delete(params.cellId);
        }
        return removed;
    }

    /** 全消去 */
    public clear(): void {
        this.lock.write(() => {
            this.allCells.clear();
            this.entryIDsByCell.clear();
            this.allEntries.clear();
            this.kdTree = null;
            this.needsRebuild = false;
        });
    }

    private markDirty(): void {
        this.needsRebuild = true;
    }

    /** インデックス再構築（必要時のみ） */
    private rebuildIfNeeded(): void {
        if (!this.needsRebuild) return;
        this.kdTree =
            this.allCells.size > 0 ? new KDTree(Array.from(this.allCells.values())) : null;
        this.needsRebuild = false;
    }

    /** 最も近い HexCell を返す */
    public findNearest(point: GeoPoint): HexCell | null {
        return this.lock.read(() => {
            this.rebuildIfNeeded();
            return this.kdTree?.nearest(this.geocell.projection.project(point)) ?? null;
        });
    }

    /** 最も近い HexCell と距離 */
    public findNearestWithDistance(point: GeoPoint): HexCellWithDistance | null {
        return this.lock.read(() => {
            this.rebuildIfNeeded();
            return (
                this.kdTree?.nearestWithDistance(this.geocell.projection.project(point)) ?? null
            );
        });
    }

    /** k 近傍（距離付き） */
    public findNearestKWithDistance(params: {
        point: GeoPoint;
        k: number;
    }): HexCellWithDistance[] {
        return this.lock.read(() => {
            this.rebuildIfNeeded();
            return (
                this.kdTree?.nearestKWithDistance({
                    query: this.geocell.projection.project(params.point),
                    k: params.k,
                }) ?? []
            );
        });
    }

    /** 半径内（メートル等）にある HexCell（距離付き） */
    public findWithinRadiusWithDistance(params: {
        position: GeoPoint;
        radius: number;
    }): HexCellWithDistance[] {
        return this.lock.read(() => {
            this.rebuildIfNeeded();
            return (
                this.kdTree?.withinRadiusWithDistance({
                    query: this.geocell.projection.project(params.position),
                    radius: params.radius,
                }) ?? []
            );
        });
    }

    /** 全 HexCell */
    public all(): HexCell[] {
        return Array.from(this.allCells.values());
    }

    /** 指定 HexCell に属するエンティティID一覧（コピーを返す） */
    public getEntryIDsByHexCell(hexCell: HexCell): Set<string> | null {
        const s = this.entryIDsByCell.get(hexCell.id);
        return s ? new Set(s) : null;
    }

    /**
     * 指定位置／ズームでのピクセル数に相当する距離（m）
     * ※投影がメートルを返す前提
     */
    public metersPerPixel(params: {
        position: GeoPoint;
        zoom: number;
        pixels: number;
        tileSize?: number;
    }): number {
        const tileSize = params.tileSize ?? 256;
        if (params.pixels <= 0) throw new Error("Pixels must be positive");
        if (tileSize <= 0) throw new Error("Tile size must be positive");

        const deltaLng = (360 * params.pixels) / (tileSize * 2 ** params.zoom);

        // 経度のオーバーフロー調整
        let newLng = params.position.longitude + deltaLng;
        if (newLng > 180) newLng -= 360;
        else if (newLng < -180) newLng += 360;

        const p1 = this.geocell.projection.project(params.position);
        const p2 = this.geocell.projection.project(createGeoPoint({
            latitude: params.position.latitude,
            longitude: newLng,
            altitude: params.position.altitude ?? null,
        }));

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /** ピクセル半径内の HexCell（距離付き） */
    public findWithinPixelRadius(params: {
        position: GeoPoint;
        zoom: number;
        pixels: number;
        tileSize?: number;
    }): HexCellWithDistance[] {
        const meters = this.metersPerPixel({
            position: params.position,
            zoom: params.zoom,
            pixels: params.pixels,
            tileSize: params.tileSize ?? 256,
        });
        return this.findWithinRadiusWithDistance({
            position: params.position, 
            radius: meters,
        });
    }

    /** ID プレフィックス一致で検索（共通プレフィックス最適化想定） */
    public findByIdPrefix(prefix: string): HexCell[] {
        if (!prefix) throw new Error("Prefix cannot be empty");
        const out: HexCell[] = [];
        for (const [id, cell] of this.allCells.entries()) {
            if (id.startsWith(prefix)) out.push(cell);
        }
        return out;
    }

    /** レジストリ状態の統計 */
    public getStats(): RegistryStats {
        return {
            totalCells: this.allCells.size,
            totalEntries: this.allEntries.size,
            kdTreeBuilt: this.kdTree !== null,
            needsRebuild: this.needsRebuild,
        };
    }
}

export interface RegistryStats {
    totalCells: number;
    totalEntries: number;
    kdTreeBuilt: boolean;
    needsRebuild: boolean;
}
