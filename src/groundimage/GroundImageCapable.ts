import { OnGroundImageEventHandler, GroundImageState } from "./GroundImageState";

export interface GroundImageCapable {
    compositionGroundImages(data: GroundImageState[]): Promise<void>;
    updateGroundImage(state: GroundImageState): Promise<void>;
    /** @deprecated Use GroundImageState.onClick instead. */
    setOnGroundImageClickListener(listener: OnGroundImageEventHandler | null): void;
    hasGroundImage(state: GroundImageState): boolean;
}
