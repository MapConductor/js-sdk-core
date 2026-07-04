import { OnMarkerEventHandler } from "./OnMarkerEventHandler"
import { MarkerAnimationOverlayHost } from "./MarkerAnimationOverlay"
import { MarkerState } from "./MarkerState"

export interface MarkerCapable {
    compositionMarkers(data: MarkerState[]): Promise<void>

    updateMarker(state: MarkerState): Promise<void>

    setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void

    setOnMarkerDrag(listener: OnMarkerEventHandler | null): void

    setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void

    setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void

    setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void

    setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void

    /** Route marker animations (Drop/Bounce) to a screen-space overlay instead of geo-interpolation. */
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void

    hasMarker(state: MarkerState): boolean
}
