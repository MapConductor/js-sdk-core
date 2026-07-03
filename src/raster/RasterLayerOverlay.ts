import type { MapViewControllerInterface } from "../controller/MapViewControllerInterface";
import type { MapOverlayInterface } from "../map/MapOverlayRegistry";
import type { OverlayCollector } from "../overlay/OverlayCollector";
import type { RasterLayerCapable } from "./RasterLayerCapable";
import type { RasterLayerState } from "./RasterLayerState";

/**
 * Bridge between the React-side RasterLayerState collector and a RasterLayerCapable map controller.
 * Mirrors `RasterLayerOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the raster layer collection changes, the controller's `compositionRasterLayers()` is called.
 */
export class RasterLayerOverlay implements MapOverlayInterface<RasterLayerState> {
    constructor(private readonly collector: OverlayCollector<RasterLayerState>) {}

    subscribe(fn: (data: ReadonlyMap<string, RasterLayerState>) => void): () => void {
        return this.collector.subscribe(fn);
    }

    async render(
        data: ReadonlyMap<string, RasterLayerState>,
        controller: MapViewControllerInterface,
    ): Promise<void> {
        const capable = controller as unknown as RasterLayerCapable;
        if (typeof capable.compositionRasterLayers === "function") {
            await capable.compositionRasterLayers(Array.from(data.values()));
        }
    }
}
