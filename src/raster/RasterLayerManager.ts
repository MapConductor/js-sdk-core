import { GeoPoint } from "../features";
import { RasterLayerEntity } from "./RasterLayerEntity";

export interface RasterLayerManagerInterface<ActualLayer> {
    registerEntity(entity: RasterLayerEntity<ActualLayer>): void;
    removeEntity(id: string): RasterLayerEntity<ActualLayer> | null;
    getEntity(id: string): RasterLayerEntity<ActualLayer> | null;
    hasEntity(id: string): boolean;
    allEntities(): RasterLayerEntity<ActualLayer>[];
    clear(): void;
    updateEntity(entity: RasterLayerEntity<ActualLayer>): void;
    find(position: GeoPoint): RasterLayerEntity<ActualLayer> | null;
}

export class RasterLayerManager<ActualLayer> implements RasterLayerManagerInterface<ActualLayer> {
    private readonly entities = new Map<string, RasterLayerEntity<ActualLayer>>();

    registerEntity(entity: RasterLayerEntity<ActualLayer>): void {
        this.entities.set(entity.state.id, entity);
    }

    updateEntity(entity: RasterLayerEntity<ActualLayer>): void {
        this.entities.set(entity.state.id, entity);
    }

    removeEntity(id: string): RasterLayerEntity<ActualLayer> | null {
        const removed = this.entities.get(id) ?? null;
        if (removed) this.entities.delete(id);
        return removed;
    }

    getEntity(id: string): RasterLayerEntity<ActualLayer> | null {
        return this.entities.get(id) ?? null;
    }

    hasEntity(id: string): boolean {
        return this.entities.has(id);
    }

    allEntities(): RasterLayerEntity<ActualLayer>[] {
        return Array.from(this.entities.values());
    }

    clear(): void {
        this.entities.clear();
    }

    find(_position: GeoPoint): RasterLayerEntity<ActualLayer> | null {
        return null;
    }
}
