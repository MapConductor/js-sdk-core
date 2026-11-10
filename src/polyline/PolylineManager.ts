import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";
import { calculateMetersPerPixel } from "../spherical/CalculateMetersPerPixel";
import { WGS84Geodesic, Planar } from "../spherical";
import { createGeoRectBounds } from "../features/GeoRectBounds";
import { PolylineEntity } from "./PolylineEntity";

/** How far from a line's edge a tap still hits it, in CSS pixels: the size of a finger. */
const TAP_TOLERANCE_PX = 24;
/** Metres in a degree of latitude, as the planar hit test (PointOnLinearLineOrNull) counts them. */
const METERS_PER_DEGREE_LAT = 111_132.954;

/** A polyline's bounding box in degrees, for skipping lines far from a tap; kept per id. */
interface PolylineBox {
    readonly points: readonly GeoPoint[];
    readonly count: number;
    readonly geodesic: boolean;
    readonly south: number;
    readonly north: number;
    readonly west: number;
    readonly east: number;
}

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
    private readonly boxes = new Map<string, PolylineBox>();

    registerEntity(entity: PolylineEntity<ActualPolyline>): void {
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: PolylineEntity<ActualPolyline>): void {
        this.entities.set(entity.state.id, entity);
    }

    removeEntity(id: string): PolylineEntity<ActualPolyline> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        this.boxes.delete(id);
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
        this.boxes.clear();
    }

    /**
     * The clickable polyline nearest to `position` that `position` hits, and the
     * point on it nearest to `position`; null when it hits none.
     *
     * A tap hits a line when it is within the size of a finger
     * (`TAP_TOLERANCE_PX`) of the line's edge: of its centre line plus half its
     * `strokeWidth`, both in CSS pixels at the camera's zoom. Lines are tested
     * as they were given (geodesic ones along the geodesic), never as a tile
     * drew them. A line whose bounding box, grown by that distance, does not
     * hold the tap is skipped without looking at its segments.
     */
    find(
        position: GeoPoint,
        cameraPosition?: MapCameraPosition | null,
    ): PolylineHitResult<ActualPolyline> | null {
        const zoom = cameraPosition?.zoom ?? 0;
        const metersPerPixel = calculateMetersPerPixel({ latitude: position.latitude, zoom });
        const visibleRegion = cameraPosition?.visibleRegion?.bounds ?? null;

        let best: PolylineHitResult<ActualPolyline> | null = null;
        let bestDist = Infinity;

        for (const entity of this.entities.values()) {
            // clickable=false のポリラインはタップに対して透過する（CircleManager と同じ方針）。
            if (!entity.state.clickable) continue;
            const pts = entity.state.points;
            if (pts.length < 2) continue;
            const threshold = metersPerPixel * (TAP_TOLERANCE_PX + Math.max(0, entity.state.strokeWidth) / 2);
            if (!this.mayHit(entity, position, threshold)) continue;
            for (let i = 0; i < pts.length - 1; i++) {
                const box = createGeoRectBounds({ southWest: null, northEast: null });
                box.extend(pts[i]);
                box.extend(pts[i + 1]);
                if (visibleRegion && !visibleRegion.intersects(box)) continue;

                const result = entity.state.geodesic
                    ? WGS84Geodesic.pointOnLineOrNull({
                        from: pts[i],
                        to: pts[i + 1],
                        position,
                        thresholdMeters: threshold,
                    })
                    : Planar.pointOnLineOrNull({
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

    /**
     * Whether `position` is within `thresholdMeters` of the line's bounding box.
     * Generous on purpose (it only skips work): a false "maybe" costs a segment
     * test, a false "no" would lose a hit.
     */
    private mayHit(entity: PolylineEntity<ActualPolyline>, position: GeoPoint, thresholdMeters: number): boolean {
        const box = this.boxOf(entity);
        // Half as much again as the distance, in degrees, for the planar and
        // geodesic measures alike.
        const latMargin = (thresholdMeters / METERS_PER_DEGREE_LAT) * 1.5;
        if (position.latitude < box.south - latMargin || position.latitude > box.north + latMargin) return false;
        if (box.east - box.west >= 180) return true; // may wrap the antimeridian; test the segments
        const maxLat = Math.min(89, Math.max(Math.abs(box.south), Math.abs(box.north)) + latMargin);
        const lngMargin = latMargin / Math.cos((maxLat * Math.PI) / 180);
        const west = box.west - lngMargin;
        const east = box.east + lngMargin;
        for (const shift of [0, 360, -360]) {
            const lng = position.longitude + shift;
            if (lng >= west && lng <= east) return true;
        }
        return false;
    }

    private boxOf(entity: PolylineEntity<ActualPolyline>): PolylineBox {
        const { id, points, geodesic } = entity.state;
        const cached = this.boxes.get(id);
        if (cached && cached.points === points && cached.count === points.length && cached.geodesic === geodesic) return cached;
        let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
        const take = (lat: number, lng: number) => {
            if (lat < south) south = lat;
            if (lat > north) north = lat;
            if (lng < west) west = lng;
            if (lng > east) east = lng;
        };
        if (geodesic) {
            // A geodesic bulges past its ends; the entity samples it.
            const bounds = entity.bounds;
            if (bounds?.southWest && bounds.northEast) {
                take(bounds.southWest.latitude, bounds.southWest.longitude);
                take(bounds.northEast.latitude, bounds.northEast.longitude);
            }
        }
        for (const p of points) take(p.latitude, p.longitude);
        const box: PolylineBox = { points, count: points.length, geodesic, south, north, west, east };
        this.boxes.set(id, box);
        return box;
    }
}
