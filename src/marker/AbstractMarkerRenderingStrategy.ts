import { GeoRectBounds } from "../features"
import { MapCameraPosition } from "../types"
import { ColorDefaultIcon } from "./DefaultMarkerIcon"
import { MarkerManager } from "./MarkerManager"
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer"
import { BitmapIcon } from "./MarkerOverlayRenderer"
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy"
import { MarkerState } from "./MarkerState"

export abstract class AbstractMarkerRenderingStrategy<ActualMarker> implements MarkerRenderingStrategy<ActualMarker> {
    protected readonly defaultMarkerIcon: BitmapIcon = new ColorDefaultIcon("#FF0000").toBitmapIcon();
    
    constructor(
        /**
         * MarkerManager instance provided by dependency injection.
         * Each strategy can provide its own optimized MarkerManager implementation.
         */
        readonly markerManager: MarkerManager<ActualMarker>,
    ) {}

    abstract onCameraChanged(cameraPosition: MapCameraPosition, renderer: MarkerOverlayRenderer<ActualMarker>): Promise<void>
    
    clear() {
        this.markerManager.clear()
    }

    onAdd(_params: {
        data: MarkerState[];
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean> {
        // Do nothing here
        return Promise.resolve(false);
    }

    onUpdate(_params: {
        state: MarkerState;
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean> {
        // Do nothing here
        return Promise.resolve(false);
    }
}
