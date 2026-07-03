import { PolygonEntity } from "./PolygonEntity";
import { PolygonState } from "./PolygonState";

export interface PolygonAddParams {
    readonly state: PolygonState;
}

export interface PolygonChangeParams<ActualPolygon> {
    readonly current: PolygonEntity<ActualPolygon>;
    readonly prev: PolygonEntity<ActualPolygon>;
}

export interface PolygonOverlayRenderer<ActualPolygon> {
    onAdd(data: PolygonAddParams[]): Promise<(ActualPolygon | null)[]>;
    onChange(data: PolygonChangeParams<ActualPolygon>[]): Promise<(ActualPolygon | null)[]>;
    onRemove(data: PolygonEntity<ActualPolygon>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}
