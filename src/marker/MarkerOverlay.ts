import type { MapViewControllerInterface } from "../controller/MapViewControllerInterface";
import type { MapOverlayInterface } from "../map/MapOverlayRegistry";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import type { MarkerCapable } from "./MarkerCapable";
import type { MarkerState } from "./MarkerState";

/**
 * Bridge between the React-side MarkerState collector and a MarkerCapable map controller.
 * Mirrors `MarkerOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the marker collection changes, the controller's `compositionMarkers()` is called.
 */
export class MarkerOverlay implements MapOverlayInterface<MarkerState> {
    constructor(private readonly collector: OverlayCollector<MarkerState>) {}

    subscribe(fn: (data: ReadonlyMap<string, MarkerState>) => void): () => void {
        return this.collector.subscribe(fn);
    }

    async render(
        data: ReadonlyMap<string, MarkerState>,
        controller: MapViewControllerInterface,
    ): Promise<void> {
        const capable = controller as unknown as MarkerCapable;
        if (typeof capable.compositionMarkers === "function") {
            await capable.compositionMarkers(Array.from(data.values()));
        }
    }
}
