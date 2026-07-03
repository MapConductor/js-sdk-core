import { MarkerFingerPrint } from "./MarkerFingerPrint";
import { MarkerState } from "./MarkerState";

export interface MarkerEntity<ActualMarker> {
    marker: ActualMarker | null;
    state: MarkerState;
    fingerPrint: MarkerFingerPrint;
    visible: boolean;
    isRendered: boolean;
}

export const createMarkerEntity = <ActualMarker>(params: {
    marker: ActualMarker | null,
    state: MarkerState,
    visible?: boolean,
    isRendered?: boolean,
}) : MarkerEntity<ActualMarker> => {
    return {
        marker: params.marker,
        state: params.state,
        visible: params.visible ?? true,
        isRendered: params.isRendered ?? false,
        fingerPrint: params.state.fingerPrint(),
    };
}
