import type { MapViewControllerInterface } from "../controller/MapViewControllerInterface";
import type { MapOverlayInterface } from "../map/MapOverlayRegistry";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import type { PolylineCapable } from "./PolylineCapable";
import type { PolylineState } from "./PolylineState";

/**
 * Bridge between the React-side PolylineState collector and a PolylineCapable map controller.
 * Mirrors `PolylineOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the polyline collection changes, the controller's `compositionPolylines()` is called.
 */
export class PolylineOverlay implements MapOverlayInterface<PolylineState> {
    constructor(private readonly collector: OverlayCollector<PolylineState>) {}

    subscribe(fn: (data: ReadonlyMap<string, PolylineState>) => void): () => void {
        return this.collector.subscribe(fn);
    }

    async render(
        data: ReadonlyMap<string, PolylineState>,
        controller: MapViewControllerInterface,
    ): Promise<void> {
        const capable = controller as unknown as PolylineCapable;
        if (typeof capable.compositionPolylines === "function") {
            await capable.compositionPolylines(Array.from(data.values()));
        }
    }
}
