import type { MapViewControllerInterface } from "../controller/MapViewControllerInterface";
import type { MapOverlayInterface } from "../map/MapOverlayRegistry";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import type { GroundImageCapable } from "./GroundImageCapable";
import type { GroundImageState } from "./GroundImageState";

/**
 * Bridge between the React-side GroundImageState collector and a GroundImageCapable map controller.
 * Mirrors `GroundImageOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the ground image collection changes, the controller's `compositionGroundImages()` is called.
 */
export class GroundImageOverlay implements MapOverlayInterface<GroundImageState> {
    constructor(private readonly collector: OverlayCollector<GroundImageState>) {}

    subscribe(fn: (data: ReadonlyMap<string, GroundImageState>) => void): () => void {
        return this.collector.subscribe(fn);
    }

    async render(
        data: ReadonlyMap<string, GroundImageState>,
        controller: MapViewControllerInterface,
    ): Promise<void> {
        const capable = controller as unknown as GroundImageCapable;
        if (typeof capable.compositionGroundImages === "function") {
            await capable.compositionGroundImages(Array.from(data.values()));
        }
    }
}
