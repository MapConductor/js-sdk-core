import { CircleFingerPrint, CircleState } from "./CircleState";

export interface CircleEntity<ActualCircle> {
    circle: ActualCircle;
    readonly state: CircleState;
    readonly fingerPrint: CircleFingerPrint;
}

export const createCircleEntity = <ActualCircle>(params: {
    circle: ActualCircle;
    state: CircleState;
}): CircleEntity<ActualCircle> => ({
    circle: params.circle,
    state: params.state,
    fingerPrint: params.state.fingerPrint(),
});
