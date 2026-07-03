import { MapCameraPosition } from "../types";
import { RasterLayerEntity } from "./RasterLayerEntity";
import { RasterLayerState } from "./RasterLayerState";

export interface RasterLayerAddParams {
    readonly state: RasterLayerState;
}

export interface RasterLayerChangeParams<ActualLayer> {
    readonly current: RasterLayerEntity<ActualLayer>;
    readonly prev: RasterLayerEntity<ActualLayer>;
}

export interface RasterLayerOverlayRenderer<ActualLayer> {
    onAdd(data: RasterLayerAddParams[]): Promise<(ActualLayer | null)[]>;
    onChange(data: RasterLayerChangeParams<ActualLayer>[]): Promise<(ActualLayer | null)[]>;
    onRemove(data: RasterLayerEntity<ActualLayer>[]): Promise<void>;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
}
