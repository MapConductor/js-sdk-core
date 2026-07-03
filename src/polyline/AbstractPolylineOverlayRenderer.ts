import { MapViewHolder } from "../map";
import { PolylineEntity } from "./PolylineEntity";
import { PolylineAddParams, PolylineChangeParams, PolylineOverlayRenderer } from "./PolylineOverlayRenderer";
import { PolylineState } from "./PolylineState";

export abstract class AbstractPolylineOverlayRenderer<
    MapViewHolderType extends MapViewHolder<unknown, unknown>,
    ActualPolyline,
> implements PolylineOverlayRenderer<ActualPolyline> {
    constructor(public readonly holder: MapViewHolderType) {}

    abstract createPolyline(state: PolylineState): Promise<ActualPolyline | null>;
    abstract updatePolylineProperties(params: {
        polyline: ActualPolyline;
        current: PolylineEntity<ActualPolyline>;
        prev: PolylineEntity<ActualPolyline>;
    }): Promise<ActualPolyline | null>;
    abstract removePolyline(entity: PolylineEntity<ActualPolyline>): Promise<void>;

    async onAdd(data: PolylineAddParams[]): Promise<(ActualPolyline | null)[]> {
        return Promise.all(data.map((p) => this.createPolyline(p.state)));
    }

    async onChange(data: PolylineChangeParams<ActualPolyline>[]): Promise<(ActualPolyline | null)[]> {
        return Promise.all(
            data.map((p) => this.updatePolylineProperties({
                polyline: p.prev.polyline,
                current: p.current,
                prev: p.prev,
            })),
        );
    }

    async onRemove(data: PolylineEntity<ActualPolyline>[]): Promise<void> {
        await Promise.all(data.map((e) => this.removePolyline(e)));
    }

    async onPostProcess(): Promise<void> {}
}
