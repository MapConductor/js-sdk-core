import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy";
import { StrategyMarkerController } from "./StrategyMarkerController";

export interface MarkerEventController<ActualMarker> {
    readonly controller?: StrategyMarkerController<ActualMarker>;
    readonly renderer?: MarkerOverlayRenderer<ActualMarker>;
}

export interface MarkerRenderingSupport<ActualMarker> {
    createMarkerRenderer(
        strategy: MarkerRenderingStrategy<ActualMarker>,
    ): MarkerOverlayRenderer<ActualMarker>;

    createMarkerEventController(
        controller: StrategyMarkerController<ActualMarker>,
        renderer: MarkerOverlayRenderer<ActualMarker>,
    ): MarkerEventController<ActualMarker>;

    registerMarkerEventController(controller: MarkerEventController<ActualMarker>): void;

    mapLoadedState?: { value: boolean } | null;

    onMarkerRenderingReady?(): void;
}

export const MarkerRenderingSupportKey = Symbol("MarkerRenderingSupport");
