import { OnPolygonEventHandler, PolygonState } from "./PolygonState";

export interface PolygonCapable {
    compositionPolygons(data: PolygonState[]): Promise<void>;
    updatePolygon(state: PolygonState): Promise<void>;
    /** @deprecated Use PolygonState.onClick instead. */
    setOnPolygonClickListener(listener: OnPolygonEventHandler | null): void;
    hasPolygon(state: PolygonState): boolean;
}
