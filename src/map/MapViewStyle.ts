import type { RasterLayerState } from '../raster/RasterLayerState';
import type { LocalTileServer } from '../tileserver/LocalTileServer';
import type { MapServiceRegistry } from './MapServiceRegistry';

/**
 * How a map looks, as a property of the map rather than a layer inside it.
 *
 * A vector style *is* the basemap, so passing one to `<XxxView style={...}>`
 * says what it is rather than mounting something over it. What happens
 * underneath depends on the backend and the app does not have to know:
 * MapLibre, Mapbox and MapTiler are told the style and draw it themselves;
 * Google Maps, Leaflet, Cesium, OpenLayers and the rest are handed raster
 * tiles rendered from the same style in a worker. Either way the same
 * adjustments produce the same map.
 *
 * An interface rather than a class, for two reasons. Core must not depend on
 * the style compiler or the rasteriser — both are optional, and one of them
 * is a wasm binary — so what core holds is the seam and the modules bring
 * the implementation. And a provider's own styling, which is nothing like a
 * MapLibre style, can be added later as another implementation without this
 * changing.
 *
 * The concrete implementations live in the vector style module; an app does
 * not implement this.
 *
 * android-sdk-core and ios-sdk-core carry the same seam.
 */
export interface MapViewStyle {
    /**
     * What identifies this style's content.
     *
     * The map re-installs a style whose key changed and leaves alone one
     * whose key did not. Two objects describing the same thing must have the
     * same key: a style built inline in JSX is a new object on every
     * render — which is exactly what a colour picker produces — and keying
     * off identity would reinstall the whole style on every unrelated state
     * change.
     */
    readonly key: string;

    /**
     * Puts the style on the map. Called once the map has a style loaded, and
     * again if it loads another one.
     *
     * @returns the ticket that takes it off again. Disposing must leave the
     *   map as it was found: a style that cannot be fully undone has no
     *   business being installed, because the app will switch away from it.
     */
    install(host: MapStyleHost): MapStyleInstallation;
}

/**
 * A ticket to undo, and a chance to take a change without tearing down.
 *
 * Returned by anything that sets something up on a map.
 */
export interface MapStyleInstallation {
    dispose(): void;

    /**
     * Takes `next` in place, when it is near enough to what is installed,
     * and answers whether it did.
     *
     * Without this the whole point is lost. A style whose key changed is
     * installed again, and installing a style means handing the map a
     * document — which is the reload this design exists to avoid. Moving a
     * colour slider changes the adjustments and nothing else, so the
     * installed style answers true, applies the difference, and the map
     * never reloads anything.
     *
     * Left out, or false, and the caller disposes and installs `next` from
     * scratch. False is always correct, only slower.
     */
    update?(next: MapViewStyle): boolean;
}

/**
 * What a map offers to the style installed on it.
 *
 * The provider implements this; a {@link MapViewStyle} uses it and never
 * touches a provider type. That is what keeps one style implementation
 * working on every backend.
 */
export interface MapStyleHost {
    /**
     * Where to look for what this map can do: `VectorStyleSupportKey` to
     * hand over a style document, `VectorStyleMutationSupportKey` to change
     * a loaded one in place, `RasterTilePreferenceKey` for the tile size it
     * would rather have.
     */
    readonly serviceRegistry: MapServiceRegistry;

    /** For serving a style document, or tiles rendered from one, to the map. */
    readonly tileServer: LocalTileServer;

    /**
     * The vector style the map is drawing now, when it is drawing one.
     *
     * Undefined on every backend that has no such thing, which is most of
     * them. It is how a rule set that adjusts "whatever is showing" finds
     * something to adjust: the style has to be read before a rule can be
     * matched against its layers, and only the map knows where it came from.
     */
    readonly vectorStyleUrl?: string;

    /**
     * Runs `block` whenever the map finishes loading a style, including the
     * one it has now if it already has one.
     *
     * Everything a style installs on a live renderer is lost when that
     * renderer loads a document again, for any reason. This is how it gets
     * put back.
     */
    onStyleLoaded(block: () => void): MapStyleInstallation;

    /**
     * Adds or updates a raster layer the app did not declare.
     *
     * The raster path needs somewhere to put its tiles, and that cannot be
     * the children of the view: the style is a prop, so it is installed from
     * outside the tree. Marker tiling already mounts its layer the same way.
     */
    upsertRaster(state: RasterLayerState): void;

    removeRaster(id: string): void;

    /**
     * Says what the app should know: a rule that matched nothing, an
     * adjustment this backend cannot make, a style that could not be read.
     *
     * Routed to whatever the host gave the style, so a module can report
     * without knowing how the app logs.
     */
    report(diagnostics: readonly string[]): void;
}

/**
 * ラスターレイヤを children の外から載せられるコントローラ。
 *
 * {@link RasterLayerController} が既に両方持っている。これは「どのプロバイダの
 * コントローラか」を知らずにそこへ届くための名前。
 */
export interface RasterLayerMounting {
    upsert(state: RasterLayerState): Promise<void>;
    removeById(id: string): Promise<void>;
}

/**
 * A style that can be carried to a native map SDK instead of installed here.
 *
 * React Native is the one host where {@link MapViewStyle.install} cannot do
 * the work. The compiler is a wasm binary and Hermes has no wasm, so the
 * style cannot be compiled in JavaScript on a device — and the map is not a
 * JavaScript object anyway: it is the Android or iOS SDK, which already has
 * the whole of this working natively.
 *
 * So on React Native the style is not installed; it is **described**, sent
 * across the bridge as two strings, and rebuilt on the other side by the
 * platform's own vector style module. The map a user sees is produced by
 * exactly the code an Android or iOS app would run, which is why there is
 * nothing here about how it is drawn.
 *
 * Core declares the shape; `@mapconductor/react-vectorstyle` fills it in.
 */
export interface NativeStyleDescriptor {
    /** The style document itself, when the app had it. */
    readonly documentJson?: string;
    /** Where to fetch the document, when the app named a URL. */
    readonly documentUrl?: string;
    /** Headers for that fetch — an API key, usually. */
    readonly documentHeaders?: Readonly<Record<string, string>>;
    /**
     * Neither of the above: adjust whatever the map is already drawing.
     * The native side reads the design's own style URL.
     */
    readonly fromCurrentDesign?: boolean;
    /** The rules document, in the form every platform's compiler reads. */
    readonly rulesJson: string;
}

/**
 * A {@link MapViewStyle} that knows how to describe itself to a native SDK.
 *
 * Checked structurally rather than by class, so core stays free of the
 * module that implements it.
 */
export interface NativeDescribableStyle extends MapViewStyle {
    toNativeDescriptor(): NativeStyleDescriptor;
}

/** Whether `style` can be sent to a native SDK rather than installed here. */
export function isNativeDescribableStyle(
    style: MapViewStyle | null | undefined,
): style is NativeDescribableStyle {
    return typeof (style as Partial<NativeDescribableStyle> | null)?.toNativeDescriptor === 'function';
}
