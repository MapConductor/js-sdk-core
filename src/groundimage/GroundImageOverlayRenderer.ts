import { GroundImageEntity } from "./GroundImageEntity";
import { GroundImageState } from "./GroundImageState";

export interface GroundImageAddParams {
    readonly state: GroundImageState;
}

export interface GroundImageChangeParams<ActualGroundImage> {
    readonly current: GroundImageEntity<ActualGroundImage>;
    readonly prev: GroundImageEntity<ActualGroundImage>;
}

export interface GroundImageOverlayRenderer<ActualGroundImage> {
    onAdd(data: GroundImageAddParams[]): Promise<(ActualGroundImage | null)[]>;
    onChange(data: GroundImageChangeParams<ActualGroundImage>[]): Promise<(ActualGroundImage | null)[]>;
    onRemove(data: GroundImageEntity<ActualGroundImage>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}
