import { RasterLayerFingerPrint, RasterLayerState } from "./RasterLayerState";

export interface RasterLayerEntity<ActualLayer> {
    readonly layer: ActualLayer;
    readonly state: RasterLayerState;
    readonly fingerPrint: RasterLayerFingerPrint;
}

export const createRasterLayerEntity = <ActualLayer>(params: {
    layer: ActualLayer;
    state: RasterLayerState;
}): RasterLayerEntity<ActualLayer> => ({
    layer: params.layer,
    state: params.state,
    fingerPrint: params.state.fingerPrint(),
});
