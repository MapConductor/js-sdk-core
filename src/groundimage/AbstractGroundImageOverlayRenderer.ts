import { MapViewHolder } from "../map";
import { GroundImageEntity } from "./GroundImageEntity";
import { GroundImageAddParams, GroundImageChangeParams, GroundImageOverlayRenderer } from "./GroundImageOverlayRenderer";
import { GroundImageState } from "./GroundImageState";

export abstract class AbstractGroundImageOverlayRenderer<
    MapViewHolderType extends MapViewHolder<unknown, unknown>,
    ActualGroundImage,
> implements GroundImageOverlayRenderer<ActualGroundImage> {
    constructor(public readonly holder: MapViewHolderType) {}

    abstract createGroundImage(state: GroundImageState): Promise<ActualGroundImage | null>;
    abstract updateGroundImageProperties(params: {
        groundImage: ActualGroundImage;
        current: GroundImageEntity<ActualGroundImage>;
        prev: GroundImageEntity<ActualGroundImage>;
    }): Promise<ActualGroundImage | null>;
    abstract removeGroundImage(entity: GroundImageEntity<ActualGroundImage>): Promise<void>;

    async onAdd(data: GroundImageAddParams[]): Promise<(ActualGroundImage | null)[]> {
        return Promise.all(data.map((p) => this.createGroundImage(p.state)));
    }

    async onChange(data: GroundImageChangeParams<ActualGroundImage>[]): Promise<(ActualGroundImage | null)[]> {
        return Promise.all(
            data.map((p) => this.updateGroundImageProperties({
                groundImage: p.prev.groundImage,
                current: p.current,
                prev: p.prev,
            })),
        );
    }

    async onRemove(data: GroundImageEntity<ActualGroundImage>[]): Promise<void> {
        await Promise.all(data.map((e) => this.removeGroundImage(e)));
    }

    async onPostProcess(): Promise<void> {}
}
