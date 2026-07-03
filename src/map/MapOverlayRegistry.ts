import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';

export interface MapOverlayInterface<DataType> {
    subscribe(fn: (data: ReadonlyMap<string, DataType>) => void): () => void;
    render(data: ReadonlyMap<string, DataType>, controller: MapViewControllerInterface): Promise<void>;
}

export class MapOverlayRegistry {
    private readonly overlays: MapOverlayInterface<unknown>[] = [];

    register(overlay: MapOverlayInterface<unknown>): void {
        if (this.overlays.includes(overlay)) return;
        this.overlays.push(overlay);
    }

    getAll(): MapOverlayInterface<unknown>[] {
        return this.overlays.slice();
    }
}
