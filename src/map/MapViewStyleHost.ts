import type { BaseMapViewController } from '../controller/BaseMapViewController';
import type { RasterLayerState } from '../raster/RasterLayerState';
import type { LocalTileServer } from '../tileserver/LocalTileServer';
import { TileServerRegistry } from '../tileserver/TileServerRegistry';
import type { MapServiceRegistry } from './MapServiceRegistry';
import type { MapStyleHost, MapStyleInstallation, MapViewStyle } from './MapViewStyle';
import { VectorStyleSupportKey } from './VectorStyleSupport';

/**
 * What a map offers the style installed on it, and the bookkeeping that
 * keeps it installed.
 *
 * One class for every provider. Everything it needs that differs per
 * backend is reached through seams every provider already fills in — the
 * service registry for what the map can do, the controller's overlay
 * controllers for mounting tiles, the controller's style-loaded listeners
 * for putting an adjustment back after a reload. Adding a provider needs
 * nothing here.
 *
 * android-sdk's `MapViewStyleEffect` and ios-sdk's `MapViewStyleHost` do the
 * same work; the shape differs because each framework owns its lifecycle
 * differently.
 */
export class MapViewStyleHost implements MapStyleHost {
    private installation: MapStyleInstallation | null = null;
    private installedKey: string | null = null;
    private diagnosticsHandler: ((diagnostics: readonly string[]) => void) | null = null;

    /** How many updates in a row the installed style has refused. See {@link apply}. */
    private refusedUpdates = 0;

    constructor(
        readonly serviceRegistry: MapServiceRegistry,
        private readonly controller: BaseMapViewController,
    ) {}

    /**
     * Keeps `style` installed on this map.
     *
     * Called on every render that reaches the hook, so most calls do
     * nothing. Three things have to line up and none of them is the render:
     *
     * - **A style whose key did not change must be left alone.** A style
     *   built inline in JSX is a new object on every render — which is
     *   exactly what a colour picker produces — so comparing objects would
     *   reinstall on every unrelated state change.
     * - **A changed style is usually an adjustment, not a new style.**
     *   Disposing and installing again hands the map a document and reloads
     *   it, which is the cost this whole design exists to avoid. What is
     *   installed is offered the new one first and only replaced if it
     *   refuses.
     * - **Null means take it off.** An app that stops passing a style gets
     *   the map it had before, not the one the style left behind.
     */
    apply(
        style: MapViewStyle | null | undefined,
        onDiagnostics?: ((diagnostics: readonly string[]) => void) | null,
    ): void {
        this.diagnosticsHandler = onDiagnostics ?? null;
        if (!style) {
            this.dispose();
            return;
        }
        if (this.installation === null) {
            this.installation = style.install(this);
            this.installedKey = style.key;
            return;
        }
        // Nothing changed at all. The key covers the document *and* the
        // rules, so an equal key means there is no work — and doing it
        // anyway is not merely wasteful: recompiling re-reports the
        // diagnostics, an app that renders them sets state, that renders
        // again, and the two spin against each other.
        if (this.installedKey === style.key) return;

        // The adjustments moved. Offer them to what is installed: taking
        // them in place is what keeps a slider from reloading the map.
        if (this.installation.update?.(style) === true) {
            this.installedKey = style.key;
            this.refusedUpdates = 0;
            return;
        }

        // Refused — correct, only slower. Refusing every time means the
        // style cannot recognise its own successor and the map is rebuilt
        // on each change; the usual cause is a value the style compares by
        // identity being rebuilt too, a rasteriser constructed inline in
        // the component rather than held in `useMemo`/`useRef`.
        this.refusedUpdates += 1;
        if (this.refusedUpdates === CHURN_THRESHOLD) {
            console.warn(
                `[MapConductor] style: the installed style has refused ${CHURN_THRESHOLD} ` +
                    'updates in a row, so the map is being torn down and rebuilt on every ' +
                    'change. Hold the rasteriser (and anything else the style compares by ' +
                    'identity) in `useMemo` rather than rebuilding it.',
            );
        }
        this.installation.dispose();
        this.installation = style.install(this);
        this.installedKey = style.key;
    }

    /** Takes the style off. The hook calls this when the view goes. */
    dispose(): void {
        this.installation?.dispose();
        this.installation = null;
        this.installedKey = null;
    }

    get tileServer(): LocalTileServer {
        return TileServerRegistry.get();
    }

    get vectorStyleUrl(): string | undefined {
        return this.serviceRegistry.get(VectorStyleSupportKey)?.currentStyleUrl;
    }

    onStyleLoaded(block: () => void): MapStyleInstallation {
        const stop = this.controller.addStyleLoadedListener(block);
        return { dispose: stop };
    }

    upsertRaster(state: RasterLayerState): void {
        this.controller.mountRasterLayer(state);
    }

    removeRaster(id: string): void {
        this.controller.unmountRasterLayer(id);
    }

    report(diagnostics: readonly string[]): void {
        if (diagnostics.length === 0) return;
        if (this.diagnosticsHandler) {
            this.diagnosticsHandler(diagnostics);
            return;
        }
        // Never dropped. A rule that matched nothing, or an adjustment this
        // backend could not make, is the kind of thing that otherwise shows
        // up as "the style nearly worked" with no way to find out why.
        for (const line of diagnostics) console.warn(`[MapConductor] style: ${line}`);
    }
}

const CHURN_THRESHOLD = 5;
