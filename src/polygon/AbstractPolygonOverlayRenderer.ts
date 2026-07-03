import { MapViewHolder } from "../map";
import { PolygonEntity } from "./PolygonEntity";
import { PolygonAddParams, PolygonChangeParams, PolygonOverlayRenderer } from "./PolygonOverlayRenderer";
import { PolygonState } from "./PolygonState";

export abstract class AbstractPolygonOverlayRenderer<
    MapViewHolderType extends MapViewHolder<unknown, unknown>,
    ActualPolygon,
> implements PolygonOverlayRenderer<ActualPolygon> {
    constructor(public readonly holder: MapViewHolderType) {}

    abstract removePolygon(entity: PolygonEntity<ActualPolygon>): Promise<void>;
    abstract createPolygon(state: PolygonState): Promise<ActualPolygon | null>;
    abstract updatePolygonProperties(params: {
        polygon: ActualPolygon;
        current: PolygonEntity<ActualPolygon>;
        prev: PolygonEntity<ActualPolygon>;
    }): Promise<ActualPolygon | null>;

    async onAdd(data: PolygonAddParams[]): Promise<(ActualPolygon | null)[]> {
        return Promise.all(data.map((p) => this.createPolygon(p.state)));
    }

    async onChange(data: PolygonChangeParams<ActualPolygon>[]): Promise<(ActualPolygon | null)[]> {
        return Promise.all(
            data.map((p) => this.updatePolygonProperties({
                polygon: p.prev.polygon,
                current: p.current,
                prev: p.prev,
            })),
        );
    }

    async onRemove(data: PolygonEntity<ActualPolygon>[]): Promise<void> {
        await Promise.all(data.map((e) => this.removePolygon(e)));
    }

    async onPostProcess(): Promise<void> {}
}
