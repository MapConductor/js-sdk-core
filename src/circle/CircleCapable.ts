import { CircleState, OnCircleEventHandler } from "./CircleState";

export interface CircleCapable {
    compositionCircles(data: CircleState[]): Promise<void>;
    updateCircle(state: CircleState): Promise<void>;
    /** @deprecated Use CircleState.onClick instead. */
    setOnCircleClickListener(listener: OnCircleEventHandler | null): void;
    hasCircle(state: CircleState): boolean;
}
