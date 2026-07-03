import type { MapViewControllerInterface } from "../controller/MapViewControllerInterface";
import type { MapOverlayInterface } from "../map/MapOverlayRegistry";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import type { CircleCapable } from "./CircleCapable";
import type { CircleState } from "./CircleState";

/**
 * Bridge between the React-side CircleState collector and a CircleCapable map controller.
 * Mirrors `CircleOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the circle collection changes, the controller's `compositionCircles()` is called.
 */
export class CircleOverlay implements MapOverlayInterface<CircleState> {
    constructor(private readonly collector: OverlayCollector<CircleState>) {}

    subscribe(fn: (data: ReadonlyMap<string, CircleState>) => void): () => void {
        return this.collector.subscribe(fn);
    }

    async render(
        data: ReadonlyMap<string, CircleState>,
        controller: MapViewControllerInterface,
    ): Promise<void> {
        const capable = controller as unknown as CircleCapable;
        if (typeof capable.compositionCircles === "function") {
            await capable.compositionCircles(Array.from(data.values()));
        }
    }
}
