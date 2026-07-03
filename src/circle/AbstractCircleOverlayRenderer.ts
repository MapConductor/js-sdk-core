import { MapViewHolder } from "../map";
import { CircleEntity } from "./CircleEntity";
import { CircleAddParams, CircleChangeParams, CircleOverlayRenderer } from "./CircleOverlayRenderer";
import { CircleState } from "./CircleState";

export abstract class AbstractCircleOverlayRenderer<
    MapViewHolderType extends MapViewHolder<unknown, unknown>,
    ActualCircle,
> implements CircleOverlayRenderer<ActualCircle> {
    constructor(public readonly holder: MapViewHolderType) {}

    abstract removeCircle(entity: CircleEntity<ActualCircle>): Promise<void>;
    abstract createCircle(state: CircleState): Promise<ActualCircle | null>;
    abstract updateCircleProperties(params: {
        circle: ActualCircle;
        current: CircleEntity<ActualCircle>;
        prev: CircleEntity<ActualCircle>;
    }): Promise<ActualCircle | null>;

    async onAdd(data: CircleAddParams[]): Promise<(ActualCircle | null)[]> {
        return Promise.all(data.map((p) => this.createCircle(p.state)));
    }

    async onChange(data: CircleChangeParams<ActualCircle>[]): Promise<(ActualCircle | null)[]> {
        return Promise.all(
            data.map((p) => this.updateCircleProperties({
                circle: p.prev.circle,
                current: p.current,
                prev: p.prev,
            })),
        );
    }

    async onRemove(data: CircleEntity<ActualCircle>[]): Promise<void> {
        await Promise.all(data.map((e) => this.removeCircle(e)));
    }

    async onPostProcess(): Promise<void> {
        // default no-op
    }
}
