import type { MapViewControllerInterface } from "../controller/MapViewControllerInterface";
import type { MapOverlayInterface } from "../map/MapOverlayRegistry";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import type { PolygonCapable } from "./PolygonCapable";
import type { PolygonState } from "./PolygonState";

/**
 * Bridge between the React-side PolygonState collector and a PolygonCapable map controller.
 * Mirrors `PolygonOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the polygon collection changes, the controller's `compositionPolygons()` is called.
 */
export class PolygonOverlay implements MapOverlayInterface<PolygonState> {
    constructor(private readonly collector: OverlayCollector<PolygonState>) {}

    subscribe(fn: (data: ReadonlyMap<string, PolygonState>) => void): () => void {
        return this.collector.subscribe(fn);
    }

    async render(
        data: ReadonlyMap<string, PolygonState>,
        controller: MapViewControllerInterface,
    ): Promise<void> {
        const capable = controller as unknown as PolygonCapable;
        if (typeof capable.compositionPolygons === "function") {
            await capable.compositionPolygons(Array.from(data.values()));
        }
    }
}
