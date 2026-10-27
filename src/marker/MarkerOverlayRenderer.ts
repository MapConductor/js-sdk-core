import type { MapViewHolder } from "../map";
import { MarkerEntity } from "./MarkerEntity";
import { MarkerAnimationOverlayHost } from "./MarkerAnimationOverlay";
import { MarkerState } from "./MarkerState";
import { OnMarkerEventHandler } from "./OnMarkerEventHandler";

export interface BitmapIcon {
    url: string;
    anchor: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
    /**
     * Where the icon is actually drawn, as fractions of the bitmap (0 to 1). A
     * default pin sits in a square bitmap with transparent space on either side
     * of it; a tap there should not count. Absent: the whole bitmap. Read it
     * through {@link markerHitShape}.
     */
    hitBounds?: { left: number; top: number; right: number; bottom: number };
}

export interface AddParams {
    state: MarkerState;
    bitmapIcon: BitmapIcon;
}

export interface ChangeParams<ActualMarker> {
    current: MarkerEntity<ActualMarker>
    bitmapIcon: BitmapIcon
    prev: MarkerEntity<ActualMarker>
}

export interface MarkerOverlayRenderer<ActualMarker> {
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;

    /**
     * View holder used for screen-space hit testing (see
     * `StrategyMarkerController.find`). Mirrors the native
     * `MarkerOverlayRendererInterface.holder`; optional because the interface
     * predates it — every `AbstractMarkerOverlayRenderer` subclass provides it.
     */
    readonly holder?: MapViewHolder<unknown, unknown>;

    /**
     * Set by the view layer to hand animation playback off to a screen-space
     * overlay instead of interpolating geographic coordinates. `null` (the
     * default) falls back to the legacy per-provider geo-interpolation.
     */
    animationOverlayHost: MarkerAnimationOverlayHost | null;

    onAdd(data: AddParams[]): Promise<(ActualMarker | null)[]>

    onChange(data: ChangeParams<ActualMarker>[]) : Promise<(ActualMarker | null)[]>

    onRemove(data: MarkerEntity<ActualMarker>[]): Promise<void>

    onAnimate(entity: MarkerEntity<ActualMarker>): Promise<void>

    onPostProcess(): Promise<void>

    /** Toggle native marker visibility while a screen-space overlay animation is playing. */
    setMarkerVisible(entity: MarkerEntity<ActualMarker>, visible: boolean): void
}
