import { CircleFingerPrint, CircleState } from "./CircleState";

export interface CircleEntity<ActualCircle> {
    circle: ActualCircle;
    readonly state: CircleState;
    readonly fingerPrint: CircleFingerPrint;
    readonly appliedRevision?: number;
}

export const createCircleEntity = <ActualCircle>(params: {
    circle: ActualCircle;
    state: CircleState;
}): CircleEntity<ActualCircle> => ({
    circle: params.circle,
    state: params.state,
    appliedRevision: params.state.revision,
    fingerPrint: params.state.fingerPrint(),
});
