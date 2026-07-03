import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { calculateMetersPerPixel } from "../sperical/CalculateMetersPerPixel";
import { isPointOnLinearLine } from "../sperical/IsPointOnLinearLine";
import { pointOnGeodesicSegmentOrNull } from "../sperical/PointOnGeodesicSegmentOrNull";
import { createGeoRectBounds } from "../features/GeoRectBounds";
import { PolylineEntity } from "./PolylineEntity";

const TAP_TOLERANCE_PX = 24;

export interface PolylineHitResult<ActualPolyline> {
    readonly entity: PolylineEntity<ActualPolyline>;
    readonly closestPoint: GeoPoint;
}

export interface PolylineManagerInterface<ActualPolyline> {
    registerEntity(entity: PolylineEntity<ActualPolyline>): void;
    removeEntity(id: string): PolylineEntity<ActualPolyline> | null;
    getEntity(id: string): PolylineEntity<ActualPolyline> | null;
    hasEntity(id: string): boolean;
    allEntities(): PolylineEntity<ActualPolyline>[];
    clear(): void;
    updateEntity(entity: PolylineEntity<ActualPolyline>): void;
    find(position: GeoPoint, cameraPosition?: MapCameraPosition | null): PolylineHitResult<ActualPolyline> | null;
}

export class PolylineManager<ActualPolyline> implements PolylineManagerInterface<ActualPolyline> {
    private readonly entities = new Map<string, PolylineEntity<ActualPolyline>>();

    registerEntity(entity: PolylineEntity<ActualPolyline>): void {
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: PolylineEntity<ActualPolyline>): void {
        this.entities.set(entity.state.id, entity);
    }

    removeEntity(id: string): PolylineEntity<ActualPolyline> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        return removed;
    }

    getEntity(id: string): PolylineEntity<ActualPolyline> | null {
        return this.entities.get(id) ?? null;
    }

    hasEntity(id: string): boolean {
        return this.entities.has(id);
    }

    allEntities(): PolylineEntity<ActualPolyline>[] {
        return Array.from(this.entities.values());
    }

    clear(): void {
        this.entities.clear();
    }

    find(
        position: GeoPoint,
        cameraPosition?: MapCameraPosition | null,
    ): PolylineHitResult<ActualPolyline> | null {
        const zoom = cameraPosition?.zoom ?? 0;
        const threshold = calculateMetersPerPixel({ latitude: position.latitude, zoom }) * TAP_TOLERANCE_PX;
        const visibleRegion = cameraPosition?.visibleRegion?.bounds ?? null;

        let best: PolylineHitResult<ActualPolyline> | null = null;
        let bestDist = Infinity;

        for (const entity of this.entities.values()) {
            const pts = entity.state.points;
            for (let i = 0; i < pts.length - 1; i++) {
                const box = createGeoRectBounds({ southWest: null, northEast: null });
                box.extend(pts[i]);
                box.extend(pts[i + 1]);
                if (visibleRegion && !visibleRegion.intersects(box)) continue;

                const result = entity.state.geodesic
                    ? pointOnGeodesicSegmentOrNull({
                        from: pts[i],
                        to: pts[i + 1],
                        position,
                        thresholdMeters: threshold,
                    })
                    : isPointOnLinearLine({
                        from: pts[i],
                        to: pts[i + 1],
                        position,
                        thresholdMeters: threshold,
                    });

                if (result != null && result[1] < bestDist) {
                    bestDist = result[1];
                    best = { entity, closestPoint: result[0] };
                }
            }
        }
        return best;
    }
}
