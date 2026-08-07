import { GeoRectBounds } from "../features"
import { MapCameraPosition } from "../types"
import { ColorDefaultIcon } from "./ColorDefaultIcon"
import { MarkerManager } from "./MarkerManager"
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer"
import { BitmapIcon } from "./MarkerOverlayRenderer"
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy"
import { MarkerState } from "./MarkerState"

export abstract class AbstractMarkerRenderingStrategy<ActualMarker> implements MarkerRenderingStrategy<ActualMarker> {
    // android-sdk / ios-sdk と同じく素の DefaultMarkerIcon（既定色は赤）を使う。
    protected readonly defaultMarkerIcon: BitmapIcon = new ColorDefaultIcon().toBitmapIcon();
    
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
