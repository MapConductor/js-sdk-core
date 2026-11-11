import { GeoPoint } from "../features";
import { Earth } from "../projection/Earth";
import { calculateMetersPerPixel } from "../spherical/CalculateMetersPerPixel";
import { computeDistanceBetween } from "../spherical/Spherical";
import type { MapCameraPosition } from "../types";
import { CircleEntity, createCircleEntity } from "./CircleEntity";
import type { CircleState } from './CircleState';
import type { CircleTiler } from './CircleTiler';
import { effectiveCircleZIndex } from "./CircleZIndex";

/** Metres per degree of latitude on the sphere computeDistanceBetween measures on. */
const METERS_PER_DEGREE = (Earth.RADIUS_METERS * Math.PI) / 180;

export interface CircleManagerInterface<ActualCircle> {
    registerEntity(entity: CircleEntity<ActualCircle>): void;
    removeEntity(id: string): CircleEntity<ActualCircle> | null;
    getEntity(id: string): CircleEntity<ActualCircle> | null;
    hasEntity(id: string): boolean;
    allEntities(): CircleEntity<ActualCircle>[];
    nativeEntities?(): CircleEntity<ActualCircle>[];
    setTiledSource?(source: CircleTiler | null): boolean;
    clear(): void;
    /**
     * The clickable circle `position` hits, or null. With `cameraPosition`, the
     * outer half of a circle's outline (`strokeWidth` CSS px at that zoom) is
     * part of it.
     */
    find(position: GeoPoint, cameraPosition?: MapCameraPosition | null): CircleEntity<ActualCircle> | null;
    updateEntity(entity: CircleEntity<ActualCircle>): void;
}

export class CircleManager<ActualCircle> implements CircleManagerInterface<ActualCircle> {
    private readonly entities = new Map<string, CircleEntity<ActualCircle>>();
    private tiledSource: CircleTiler | null = null;

    setTiledSource(source: CircleTiler | null): boolean { this.tiledSource = source; return true; }
    private tiledEntity(state: CircleState): CircleEntity<ActualCircle> {
        return createCircleEntity({ circle: null as unknown as ActualCircle, state });
    }

    getEntity(id: string): CircleEntity<ActualCircle> | null {
        const native = this.entities.get(id);
        const state = native ? null : this.tiledSource?.state(id);
        return native ?? (state ? this.tiledEntity(state) : null);
    }

    hasEntity(id: string): boolean {
        return this.entities.has(id) || this.tiledSource?.isTiled(id) === true;
    }

    removeEntity(id: string): CircleEntity<ActualCircle> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        if (removed) return removed;
        const state = this.tiledSource?.state(id);
        if (!state) return null;
        this.tiledSource!.remove(id);
        return this.tiledEntity(state);
    }

    registerEntity(entity: CircleEntity<ActualCircle>): void {
        if (entity.circle == null && this.tiledSource?.isTiled(entity.state.id)) {
            this.entities.delete(entity.state.id);
            return;
        }
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: CircleEntity<ActualCircle>): void {
        this.registerEntity(entity);
    }

    allEntities(): CircleEntity<ActualCircle>[] {
        const result = this.nativeEntities();
        this.tiledSource?.visitStates(state => { if (!this.entities.has(state.id)) result.push(this.tiledEntity(state)); });
        return result;
    }

    nativeEntities(): CircleEntity<ActualCircle>[] { return Array.from(this.entities.values()); }

    clear(): void {
        this.entities.clear();
        this.tiledSource = null;
    }

    /**
     * The clickable circle `position` hits; null when it hits none.
     *
     * A tap hits a circle when its distance from the centre (on the sphere) is
     * at most `radiusMeters` plus half the outline: `strokeWidth / 2` CSS pixels
     * at the camera's zoom, none without a camera. No finger tolerance is added:
     * a circle is an area, as a polygon is, and where small circles crowd a
     * finger's width would pick the neighbour. Circles are tested as they were
     * given, never as a tile drew them.
     *
     * Of several hits, the highest zIndex wins (a null zIndex is the automatic
     * one the renderers draw with), and of those the one whose centre is
     * nearest. A circle further in latitude than its reach is skipped before
     * the distance is computed.
     */
    find(position: GeoPoint, cameraPosition?: MapCameraPosition | null): CircleEntity<ActualCircle> | null {
        const zoom = cameraPosition?.zoom;
        const metersPerPixel =
            zoom != null && Number.isFinite(zoom) ? calculateMetersPerPixel({ latitude: position.latitude, zoom }) : 0;
        let best: CircleEntity<ActualCircle> | null = null;
        let bestState: CircleState | null = null;
        let bestZ = 0;
        let bestDistance = Infinity;
        const consider = (state: CircleState, entity: CircleEntity<ActualCircle> | null): void => {
            if (!state.clickable) return;
            const reach = state.radiusMeters + (metersPerPixel * Math.max(0, state.strokeWidth)) / 2;
            if (!(reach >= 0)) return;
            // The distance on the sphere is never less than the difference in latitude.
            if (Math.abs(state.center.latitude - position.latitude) * METERS_PER_DEGREE > reach * (1 + 1e-9) + 1e-6) return;
            const distance = computeDistanceBetween(state.center, position);
            if (distance > reach) return;
            const z = effectiveCircleZIndex(state);
            if (bestState == null || z > bestZ || (z === bestZ && distance < bestDistance)) {
                best = entity;
                bestState = state;
                bestZ = z;
                bestDistance = distance;
            }
        };
        for (const entity of this.entities.values()) consider(entity.state, entity);
        // Tiled circles: only those near the tap, found through the tile set's tap index.
        for (const state of this.tiledSource?.states(position.latitude, position.longitude, metersPerPixel) ?? []) {
            if (!this.entities.has(state.id)) consider(state, null);
        }
        return best ?? (bestState ? this.tiledEntity(bestState) : null);
    }
}
