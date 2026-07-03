import { GroundImageFingerPrint, GroundImageState } from "./GroundImageState";

export interface GroundImageEntity<ActualGroundImage> {
    readonly groundImage: ActualGroundImage;
    readonly state: GroundImageState;
    readonly fingerPrint: GroundImageFingerPrint;
}

export const createGroundImageEntity = <ActualGroundImage>(params: {
    groundImage: ActualGroundImage;
    state: GroundImageState;
}): GroundImageEntity<ActualGroundImage> => ({
    groundImage: params.groundImage,
    state: params.state,
    fingerPrint: params.state.fingerPrint(),
});
