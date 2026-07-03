import { GeoRectBounds } from "../features"
import { MapCameraPosition } from "../types"
import { MarkerManager } from "./MarkerManager"
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer"
import { MarkerState } from "./MarkerState"

/**
 * Strategy interface for handling marker rendering during camera changes.
 * Different map providers may have different optimal strategies for marker management.
 */
export interface MarkerRenderingStrategy<ActualMarker> {
    markerManager: MarkerManager<ActualMarker>

    clear(): void

    onAdd(params: {
        data: MarkerState[];
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>

    onUpdate(params: {
        state: MarkerState;
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>

    /**
     * Handle camera position changes and update marker rendering accordingly.
     *
     * @param cameraPosition The new camera position
     * @param renderer The marker overlay renderer
     */
    onCameraChanged(
        cameraPosition: MapCameraPosition,
        renderer: MarkerOverlayRenderer<ActualMarker>,
    ): Promise<void>
}
