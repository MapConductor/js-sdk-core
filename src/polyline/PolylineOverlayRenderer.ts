import { PolylineEntity } from "./PolylineEntity";
import { PolylineState } from "./PolylineState";

export interface PolylineAddParams {
    readonly state: PolylineState;
}

export interface PolylineChangeParams<ActualPolyline> {
    readonly current: PolylineEntity<ActualPolyline>;
    readonly prev: PolylineEntity<ActualPolyline>;
}

export interface PolylineOverlayRenderer<ActualPolyline> {
    onAdd(data: PolylineAddParams[]): Promise<(ActualPolyline | null)[]>;
    onChange(data: PolylineChangeParams<ActualPolyline>[]): Promise<(ActualPolyline | null)[]>;
    onRemove(data: PolylineEntity<ActualPolyline>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}
