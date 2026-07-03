import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";

export interface OverlayController<StateType, EntityType, EventType> {
    readonly zIndex: number;
    clickListener: ((event: EventType) => void) | null

    add(data: StateType[]): Promise<void>
    update(state: StateType): Promise<void>
    clear(): Promise<void>
    find(position: GeoPoint) : EntityType | null
    onCameraChanged(mapCameraPosition: MapCameraPosition) : Promise<void> | void

    /**
     * Cleanup resources when the controller is no longer needed.
     * IMPORTANT: Call this when switching map providers or disposing the map.
     */
    destroy() : void
}
