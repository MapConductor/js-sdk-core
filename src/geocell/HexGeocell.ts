import { GeoPoint, GeoPointInterface, createGeoPoint } from "../features";
import { MarkerState } from "../marker";
import { Projection, WebMercator } from "../projection";
import { Offset, createOffset } from "../types";
import { createHexCell, HexCell } from "./HexCell";
import { HexCoord, createHexCoord } from "./HexCoord";
import { IdentifiedHexCell } from "./IdentifiedHexCell";

export interface HexGeocell {
    projection: Projection
    baseHexSideLength: number;

    latLngToHexCoord(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCoord

    latLngToHexCell(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCell

    hexToLatLngCenter(params: {
        coord: HexCoord;
        latitude?: number;
        latHint?: number;
        zoom: number;
    }): GeoPoint

    hexToCellId(params: {
        coord: HexCoord;
        zoom: number;
    }): string

    hexToPolygonLatLng(params: {
        coord: HexCoord;
        latHint: number;
        zoom: number;
    }): GeoPoint[]

    enclosingCellOf(params: {
        points: MarkerState[];
        zoom: number;
    }): HexCell

    hexCellsForPointsWithId(params: {
        points: MarkerState[];
        zoom: number;
    }): Set<IdentifiedHexCell>

    hexDistance(params: {
        origin: HexCoord;
        dst: HexCoord;
    }): number

    hexRange(params: {
        center: HexCoord;
        radius: number;
    }): HexCoord[]
}

// ================================================================
// HexGeocellImpl（side length = 辺の長さである点に注意）
// ================================================================
export class HexGeocellImpl implements HexGeocell {

    public readonly projection: Projection;

    /** ズーム0における六角形の「辺の長さ」（m）。半径ではありません。 */
    public readonly baseHexSideLength: number = 1000;

    constructor(params: {
        projection: Projection;
        baseHexSideLength?: number;
    }) {
        this.projection = params.projection;
        this.baseHexSideLength = params.baseHexSideLength ?? 1000;
    }

    /** 緯度経度 -> 六角グリッド座標 */
    latLngToHexCoord(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCoord {
        const hexSideLength = this.adjustedHexSideLength({
            latitude: params.position.latitude,
            zoom: params.zoom,
        });
        const offset = this.projection.project(params.position);
        return this.pixelToHex({
            offset,
            sideLength: hexSideLength,
        });
    }

    /** 緯度経度 -> HexCell（ID/中心座標など含む） */
    latLngToHexCell(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCell {
        const coord = this.latLngToHexCoord(params);
        const id = this.hexToCellId({
            coord,
            zoom: params.zoom,
        });
        const centerLatLng = this.hexToLatLngCenter({
            coord,
            latitude: params.position.latitude,
            zoom: params.zoom,
        });
        const centerXY = this.projection.project(centerLatLng);
        return createHexCell({ coord, centerLatLng, centerXY, id });
    }

    /** 六角グリッド座標 -> 中心の緯度経度 */
    hexToLatLngCenter(params: {
        coord: HexCoord;
        latitude?: number;
        latHint?: number;
        zoom: number;
    }): GeoPoint {
        const latitude = params.latHint ?? params.latitude;
        if (latitude === undefined) {
            throw new Error("latitude or latHint is required");
        }
        const hexSideLength = this.adjustedHexSideLength({
            latitude,
            zoom: params.zoom,
        });
        const center = this.hexCenterXY({
            coord: params.coord,
            hexSideLength: hexSideLength,
        });
        return this.projection.unproject(center);
    }

    /** ズームを含むユニークなセルID */
    hexToCellId(params: {
        coord: HexCoord;
        zoom: number;
    }): string {
        return `H${params.coord.q}_${params.coord.r}_Z${Math.trunc(params.zoom)}`;
    }

    /** 六角形ポリゴン（6頂点）を緯度経度で返す（フラットトップ） */
    hexToPolygonLatLng(params: {
        coord: HexCoord;
        latHint: number;
        zoom: number;
    }): GeoPoint[] {
        const hexSideLength = this.adjustedHexSideLength({
            latitude: params.latHint,
            zoom: params.zoom,
        });
        const center = this.hexCenterXY({
            coord: params.coord,
            hexSideLength: hexSideLength,
        });

        // 正六角形の外接円半径（circumradius）: s * 2 / √3
        const circumRadius = (hexSideLength * 2) / Math.sqrt(3);

        const pts: GeoPoint[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = ((60 * i - 30) * Math.PI) / 180; // -30°開始でフラットトップ
            const x = center.x + circumRadius * Math.cos(angle);
            const y = center.y + circumRadius * Math.sin(angle);
            pts.push(this.projection.unproject({ x, y }));
        }
        return pts;
    }

    /** 複数点の重心を囲むセル */
    enclosingCellOf(params: {
        points: MarkerState[];
        zoom: number;
    }): HexCell {
        if (!params.points.length) {
            throw new Error("Points list cannot be empty");
        }
        const center = this.computeGeographicCentroid(
            params.points.map(p => p.position),
        );
        const coord = this.latLngToHexCoord({
            position: center,
            zoom: params.zoom,
        });
        const centerLatLng = this.hexToLatLngCenter({
            coord,
            latitude: center.latitude,
            zoom: params.zoom,
        });
        const centerXY = this.projection.project(centerLatLng);
        const id = this.hexToCellId({
            coord,
            zoom: params.zoom,
        });
        return createHexCell({ coord, centerLatLng, centerXY, id });
    }

    /** 複数点それぞれに対応する HexCell と元IDのセット */
    hexCellsForPointsWithId(params: {
        points: MarkerState[];
        zoom: number;
    }): Set<IdentifiedHexCell> {
        const cellsByIdentity = new Map<string, IdentifiedHexCell>();
        for (const it of params.points) {
            const coord = this.latLngToHexCoord({
                position: it.position,
                zoom: params.zoom,
            });
            const centerLatLng = this.hexToLatLngCenter({
                coord,
                latitude: it.position.latitude,
                zoom: params.zoom,
            });
            const centerXY = this.projection.project(centerLatLng);
            const cellId = this.hexToCellId({
                coord,
                zoom: params.zoom,
            });
            cellsByIdentity.set(`${it.id}:${cellId}`, {
                id: it.id,
                cell: createHexCell({ coord, centerLatLng, centerXY, id: cellId }),
            });
        }
        return new Set(cellsByIdentity.values());
    }

    /** 六角座標距離 */
    hexDistance(params: {
        origin: HexCoord;
        dst: HexCoord;
    }): number {
        // axial 距離式
        return (
            (Math.abs(params.origin.q - params.dst.q) +
                Math.abs(params.origin.q + params.origin.r - params.dst.q - params.dst.r) +
                Math.abs(params.origin.r - params.dst.r)) / 2
        );
    }

    /** 半径 r の六角範囲（axial） */
    hexRange(params: {
        center: HexCoord;
        radius: number;
    }): HexCoord[] {
        const results: HexCoord[] = [];
        for (let dq = -params.radius; dq <= params.radius; dq++) {
            const minR = Math.max(-params.radius, -dq - params.radius);
            const maxR = Math.min(params.radius, -dq + params.radius);
            for (let dr = minR; dr <= maxR; dr++) {
                results.push(createHexCoord({
                    q: params.center.q + dq,
                    r: params.center.r + dr,
                    depth: params.center.depth,
                }));
            }
        }
        return results;
    }

    // ------------------- ヘルパー -------------------

    /** 緯度・ズームに応じて辺長を補正（ズームは 2^-zoom、緯度スケールは cos(lat) で補正） */
    private adjustedHexSideLength(params: {
        latitude: number;
        zoom: number;
    }): number {
        const scale = 1 / 2 ** params.zoom;
        const latScale = Math.max(Math.cos((params.latitude * Math.PI) / 180), 0.01); // 0割回避
        return (this.baseHexSideLength * scale) / latScale;
    }

    /** 六角中心の XY を返す（フラットトップ） */
    private hexCenterXY(params: {
        coord: HexCoord;
        hexSideLength: number;
    }): Offset {
        // フラットトップの軸座標(q,r) -> 中心座標
        // 隣接中心間隔: q方向 = 1.5s, r方向 = √3 s
        const x = params.hexSideLength * (1.5 * params.coord.q);
        const y = params.hexSideLength * (Math.sqrt(3) * (params.coord.r + params.coord.q / 2));
        return createOffset({
            x,
            y,
        });
    }

    /** XY -> 六角座標（axial） */
    private pixelToHex(params: {
        offset: Offset,
        sideLength: number,
    }): HexCoord {
        const q = (2 / 3) * (params.offset.x / params.sideLength);
        const r = ((-1 / 3) * params.offset.x + (Math.sqrt(3) / 3) * params.offset.y) / params.sideLength;
        return this.cubeRound({
            q,
            r,
        });
    }

    /** 連続値のaxial座標(q,r)を最も近い格子点へ丸める */
    private cubeRound(params: {
        q: number,
        r: number,
    }): HexCoord {
        const s = -params.q - params.r;

        let rq = Math.round(params.q);
        let rr = Math.round(params.r);
        let rs = Math.round(s);

        const qDiff = Math.abs(rq - params.q);
        const rDiff = Math.abs(rr - params.r);
        const sDiff = Math.abs(rs - s);

        if (qDiff > rDiff && qDiff > sDiff) {
            rq = -rr - rs;
        } else if (rDiff > sDiff) {
            rr = -rq - rs;
        } else {
            rs = -rq - rr;
        }

        return createHexCoord({ q: rq, r: rr });
    }

    /** 地球曲率を考慮した重心（球面近似） */
    private computeGeographicCentroid(points: GeoPointInterface[]): GeoPoint {
        if (points.length === 1) {
            return createGeoPoint({
                latitude: points[0].latitude,
                longitude: points[0].longitude,
                altitude: points[0].altitude ?? 0,
            });
        }

        let x = 0, y = 0, z = 0;
        for (const p of points) {
            const lat = (p.latitude * Math.PI) / 180;
            const lng = (p.longitude * Math.PI) / 180;
            x += Math.cos(lat) * Math.cos(lng);
            y += Math.cos(lat) * Math.sin(lng);
            z += Math.sin(lat);
        }
        x /= points.length; y /= points.length; z /= points.length;

        const centralLng = (Math.atan2(y, x) * 180) / Math.PI;
        const centralSq = Math.sqrt(x * x + y * y);
        const centralLat = (Math.atan2(z, centralSq) * 180) / Math.PI;

        return createGeoPoint({
            latitude: centralLat,
            longitude: centralLng,
        });
    }

    // ------------------- デフォルト生成 -------------------
    static defaultGeocell(): HexGeocell {
        return new HexGeocellImpl({
            projection: WebMercator,
            baseHexSideLength: 100_000,
        }); // 100km（中ズーム向け）
    }
}
