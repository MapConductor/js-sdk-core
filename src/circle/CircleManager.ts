import { GeoPoint } from "../features";
import { computeDistanceBetween } from "../sperical/Spherical";
import { CircleEntity } from "./CircleEntity";

function calculateZIndex(center: GeoPoint): number {
    return ((-center.latitude * 1_000_000 - center.longitude) | 0);
}

export interface CircleManagerInterface<ActualCircle> {
    registerEntity(entity: CircleEntity<ActualCircle>): void;
    removeEntity(id: string): CircleEntity<ActualCircle> | null;
    getEntity(id: string): CircleEntity<ActualCircle> | null;
    hasEntity(id: string): boolean;
    allEntities(): CircleEntity<ActualCircle>[];
    clear(): void;
    find(position: GeoPoint): CircleEntity<ActualCircle> | null;
    updateEntity(entity: CircleEntity<ActualCircle>): void;
}

export class CircleManager<ActualCircle> implements CircleManagerInterface<ActualCircle> {
    private readonly entities = new Map<string, CircleEntity<ActualCircle>>();

    getEntity(id: string): CircleEntity<ActualCircle> | null {
        return this.entities.get(id) ?? null;
    }

    hasEntity(id: string): boolean {
        return this.entities.has(id);
    }

    removeEntity(id: string): CircleEntity<ActualCircle> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        return removed;
    }

    registerEntity(entity: CircleEntity<ActualCircle>): void {
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: CircleEntity<ActualCircle>): void {
        this.entities.set(entity.state.id, entity);
    }

    allEntities(): CircleEntity<ActualCircle>[] {
        return Array.from(this.entities.values());
    }

    clear(): void {
        this.entities.clear();
    }

    find(position: GeoPoint): CircleEntity<ActualCircle> | null {
        const filtered = this.allEntities().filter((entity) => {
            const distance = computeDistanceBetween(entity.state.center, position);
            return distance <= entity.state.radiusMeters && entity.state.clickable;
        });

        if (filtered.length === 0) return null;

        let maxZIndex = Number.MIN_SAFE_INTEGER;
        let maxEntity = filtered[0];
        for (const entity of filtered) {
            const z = entity.state.zIndex ?? calculateZIndex(entity.state.center);
            if (z > maxZIndex) {
                maxZIndex = z;
                maxEntity = entity;
            }
        }
        return maxEntity;
    }
}
