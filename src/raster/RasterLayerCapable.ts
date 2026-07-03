import { RasterLayerState } from "./RasterLayerState";

export interface RasterLayerCapable {
    compositionRasterLayers(data: RasterLayerState[]): Promise<void>;
    updateRasterLayer(state: RasterLayerState): Promise<void>;
    hasRasterLayer(state: RasterLayerState): boolean;
}
