import { GeoPoint } from "../features";
import { GroundImageEntity } from "./GroundImageEntity";

export interface GroundImageManagerInterface<ActualGroundImage> {
    registerEntity(entity: GroundImageEntity<ActualGroundImage>): void;
    removeEntity(id: string): GroundImageEntity<ActualGroundImage> | null;
    getEntity(id: string): GroundImageEntity<ActualGroundImage> | null;
    hasEntity(id: string): boolean;
    allEntities(): GroundImageEntity<ActualGroundImage>[];
    clear(): void;
    updateEntity(entity: GroundImageEntity<ActualGroundImage>): void;
    find(position: GeoPoint): GroundImageEntity<ActualGroundImage> | null;
}

export class GroundImageManager<ActualGroundImage> implements GroundImageManagerInterface<ActualGroundImage> {
    private readonly entities = new Map<string, GroundImageEntity<ActualGroundImage>>();

    registerEntity(entity: GroundImageEntity<ActualGroundImage>): void {
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: GroundImageEntity<ActualGroundImage>): void {
        this.entities.set(entity.state.id, entity);
    }

    removeEntity(id: string): GroundImageEntity<ActualGroundImage> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        return removed;
    }

    getEntity(id: string): GroundImageEntity<ActualGroundImage> | null {
        return this.entities.get(id) ?? null;
    }

    hasEntity(id: string): boolean {
        return this.entities.has(id);
    }

    allEntities(): GroundImageEntity<ActualGroundImage>[] {
        return Array.from(this.entities.values());
    }

    clear(): void {
        this.entities.clear();
    }

    find(position: GeoPoint): GroundImageEntity<ActualGroundImage> | null {
        for (const entity of this.entities.values()) {
            if (entity.state.bounds.contains(position)) return entity;
        }
        return null;
    }
}
