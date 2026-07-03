import { GeoPoint } from "../features";
import { createInterpolatePoints } from "../sperical/CreateInterpolatePoints";
import { PolygonEntity } from "./PolygonEntity";

function normalizeLng(lng: number): number {
    return (((lng + 180) % 360 + 360) % 360) - 180;
}

export interface PolygonManagerInterface<ActualPolygon> {
    registerEntity(entity: PolygonEntity<ActualPolygon>): void;
    removeEntity(id: string): PolygonEntity<ActualPolygon> | null;
    getEntity(id: string): PolygonEntity<ActualPolygon> | null;
    hasEntity(id: string): boolean;
    allEntities(): PolygonEntity<ActualPolygon>[];
    clear(): void;
    find(position: GeoPoint): PolygonEntity<ActualPolygon> | null;
    updateEntity(entity: PolygonEntity<ActualPolygon>): void;
}

export class PolygonManager<ActualPolygon> implements PolygonManagerInterface<ActualPolygon> {
    private readonly entities = new Map<string, PolygonEntity<ActualPolygon>>();

    registerEntity(entity: PolygonEntity<ActualPolygon>): void {
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: PolygonEntity<ActualPolygon>): void {
        this.entities.set(entity.state.id, entity);
    }

    removeEntity(id: string): PolygonEntity<ActualPolygon> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        return removed;
    }

    getEntity(id: string): PolygonEntity<ActualPolygon> | null {
        return this.entities.get(id) ?? null;
    }

    hasEntity(id: string): boolean {
        return this.entities.has(id);
    }

    allEntities(): PolygonEntity<ActualPolygon>[] {
        return Array.from(this.entities.values());
    }

    clear(): void {
        this.entities.clear();
    }

    find(position: GeoPoint): PolygonEntity<ActualPolygon> | null {
        const testX = normalizeLng(position.longitude);
        const testY = position.latitude;

        const sorted = Array.from(this.entities.values()).sort(
            (a, b) => b.state.zIndex - a.state.zIndex,
        );

        for (const entity of sorted) {
            const state = entity.state;
            const basePoints = state.points;
            if (basePoints.length < 3) continue;

            let ring: GeoPoint[];
            try {
                ring = state.geodesic ? createInterpolatePoints(basePoints) : basePoints;
            } catch {
                ring = basePoints;
            }

            const closedRing =
                ring[0] !== ring[ring.length - 1] ? [...ring, ring[0]] : ring;

            if (this.pointInPolygonWindingNumber({ testX, testY, ring: closedRing })) {
                let inHole = false;
                for (const hole of state.holes) {
                    if (hole.length < 3) continue;
                    let holeRing: GeoPoint[];
                    try {
                        holeRing = state.geodesic ? createInterpolatePoints(hole) : hole;
                    } catch {
                        holeRing = hole;
                    }
                    const closedHole =
                        holeRing[0] !== holeRing[holeRing.length - 1]
                            ? [...holeRing, holeRing[0]]
                            : holeRing;
                    if (this.pointInPolygonWindingNumber({ testX, testY, ring: closedHole })) {
                        inHole = true;
                        break;
                    }
                }
                if (!inHole) return entity;
            }
        }
        return null;
    }

    private pointInPolygonWindingNumber({
        testX,
        testY,
        ring,
    }: {
        testX: number;
        testY: number;
        ring: GeoPoint[];
    }): boolean {
        if (ring.length < 3) return false;
        const unwrapped = this.unwrapLongitudesAround(ring, testX);

        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
        for (const [x, y] of unwrapped) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }
        if (testY < minY || testY > maxY || testX < minX - 1 || testX > maxX + 1) return false;

        const eps = 1e-6;
        let wn = 0;
        for (let i = 0; i < unwrapped.length - 1; i++) {
            const [ax, ay] = unwrapped[i];
            const [bx, by] = unwrapped[i + 1];
            if (this.pointOnSegment({ px: testX, py: testY, ax, ay, bx, by, eps })) return true;
            if (ay <= testY) {
                if (by > testY && this.isLeft({ ax, ay, bx, by, px: testX, py: testY }) > 0) wn++;
            } else {
                if (by <= testY && this.isLeft({ ax, ay, bx, by, px: testX, py: testY }) < 0) wn--;
            }
        }
        return wn !== 0;
    }

    private isLeft({
        ax,
        ay,
        bx,
        by,
        px,
        py,
    }: {
        ax: number;
        ay: number;
        bx: number;
        by: number;
        px: number;
        py: number;
    }): number {
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    }

    private pointOnSegment({
        px,
        py,
        ax,
        ay,
        bx,
        by,
        eps,
    }: {
        px: number;
        py: number;
        ax: number;
        ay: number;
        bx: number;
        by: number;
        eps: number;
    }): boolean {
        const dx = bx - ax, dy = by - ay;
        const cross = dx * (py - ay) - dy * (px - ax);
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(cross) > eps * Math.max(1, segLen)) return false;
        const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
        return dot <= eps * Math.max(1, segLen);
    }

    private unwrapLongitudesAround(points: GeoPoint[], refLng: number): [number, number][] {
        const result: [number, number][] = [];
        let prevX = NaN;
        for (const p of points) {
            let x = normalizeLng(p.longitude);
            if (isNaN(prevX)) {
                const k = Math.round((refLng - x) / 360);
                x += 360 * k;
            } else {
                const delta = x - prevX;
                if (delta > 180) {
                    x -= 360 * Math.floor((delta + 180) / 360);
                } else if (delta < -180) {
                    x += 360 * Math.floor((-delta + 180) / 360);
                }
            }
            result.push([x, p.latitude]);
            prevX = x;
        }
        return result;
    }
}
