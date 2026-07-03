import { OnPolylineEventHandler, PolylineState } from "./PolylineState";

export interface PolylineCapable {
    compositionPolylines(data: PolylineState[]): Promise<void>;
    updatePolyline(state: PolylineState): Promise<void>;
    /** @deprecated Use PolylineState.onClick instead. */
    setOnPolylineClickListener(listener: OnPolylineEventHandler | null): void;
    hasPolyline(state: PolylineState): boolean;
}
