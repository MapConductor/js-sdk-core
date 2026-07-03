import { CircleEntity } from "./CircleEntity";
import { CircleState } from "./CircleState";

export interface CircleAddParams {
    readonly state: CircleState;
}

export interface CircleChangeParams<ActualCircle> {
    readonly current: CircleEntity<ActualCircle>;
    readonly prev: CircleEntity<ActualCircle>;
}

export interface CircleOverlayRenderer<ActualCircle> {
    onAdd(data: CircleAddParams[]): Promise<(ActualCircle | null)[]>;
    onChange(data: CircleChangeParams<ActualCircle>[]): Promise<(ActualCircle | null)[]>;
    onRemove(data: CircleEntity<ActualCircle>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}
