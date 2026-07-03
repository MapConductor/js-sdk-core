import { PolygonFingerPrint, PolygonState } from "./PolygonState";

export interface PolygonEntity<ActualPolygon> {
    readonly polygon: ActualPolygon;
    readonly state: PolygonState;
    readonly fingerPrint: PolygonFingerPrint;
}

export const createPolygonEntity = <ActualPolygon>(params: {
    polygon: ActualPolygon;
    state: PolygonState;
}): PolygonEntity<ActualPolygon> => ({
    polygon: params.polygon,
    state: params.state,
    fingerPrint: params.state.fingerPrint(),
});
