declare class Mutex {
    private locked;
    private queue;
    withLock<T>(fn: () => Promise<T> | T): Promise<T>;
    private acquire;
    private release;
}

interface GeoPointInterface {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    wrap?(): GeoPointInterface;
}
declare function fromLatLng({ latitude, longitude, altitude, }: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
}): GeoPoint;
declare const fromLatLong: typeof fromLatLng;
declare function fromLngLat({ longitude, latitude, altitude, }: {
    longitude: number;
    latitude: number;
    altitude?: number | null;
}): GeoPoint;
declare const fromLongLat: typeof fromLngLat;
declare function fromGeoPoint(position: GeoPointInterface): GeoPoint;
/**
 * Creates a GeoPoint from latitude and longitude
 */
declare function createGeoPoint(params: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
}): GeoPoint;
/**
 * Represents a geographic coordinate point with latitude, longitude, and optional altitude.
 */
interface GeoPoint extends GeoPointInterface {
    /** Latitude in degrees (-90 to 90) */
    latitude: number;
    /** Longitude in degrees (-180 to 180) */
    longitude: number;
    /** Altitude in meters (optional) */
    altitude?: number | null;
    isValid(): boolean;
    normalize(): GeoPoint;
    wrap(): GeoPoint;
    equals(other: GeoPoint): boolean;
    hashCode(): number;
    toUrlValue(precision: number): string;
}
declare namespace GeoPoint {
    const fromLatLng: (latitude: number, longitude: number, altitude?: number | null) => GeoPoint;
    const fromLatLong: (latitude: number, longitude: number, altitude?: number | null) => GeoPoint;
    const fromLngLat: (longitude: number, latitude: number, altitude?: number | null) => GeoPoint;
    const fromLongLat: (longitude: number, latitude: number, altitude?: number | null) => GeoPoint;
    const from: (position: GeoPointInterface) => GeoPoint;
}

/**
 * クリック座標を [-180,180] / [-90,90] に正規化する（日付変更線対策）。
 *
 * android-sdk / ios-sdk では PolylineEvent / PolygonEvent / CircleEvent /
 * GroundImageEvent の **コンストラクタ** が `clicked.wrap()` を行い、どの配送経路を
 * 通っても wrap 漏れが起きないようにしている（Polyline.kt / Polygon.kt / Circle.kt /
 * GroundImage.kt）。TypeScript の `*Event` は素の interface でコンストラクタを持てないため、
 * 代わりにイベントを配送する直前にこの関数を通すことで同じ保証を得る。
 *
 * `clicked.wrap()` を直接呼ばないこと: `GeoPoint.wrap` はファクトリのクロージャに束縛された
 * メソッドで、プロバイダが組み立てるプレーンオブジェクトには存在しない
 * （`GeoPointInterface.wrap` は optional）。`fromGeoPoint` で正規の GeoPoint に
 * 引き上げてから wrap する。android-sdk の `GeoPoint.from(it.wrap())` に対応する。
 *
 * ヒットテストの**入力**座標は wrap しないこと。
 */
declare function wrapClickedPoint(clicked: GeoPointInterface): GeoPoint;
declare function wrapClickedPoint(clicked: GeoPointInterface | null | undefined): GeoPoint | null;

/**
 * Represents a rectangular geographic boundary
 */
interface GeoRectBounds {
    /** Southwest corner of the boundary */
    southWest: GeoPoint | null;
    /** Northeast corner of the boundary */
    northEast: GeoPoint | null;
    /** Extends bounds to include a point */
    center: GeoPoint | null;
    equals: (other: GeoRectBounds | null) => boolean;
    extend(point: GeoPointInterface): void;
    /** 南西/北東のどちらかが未設定なら true。android-sdk / ios-sdk と同じくプロパティ。 */
    readonly isEmpty: boolean;
    intersects(other: GeoRectBounds): boolean;
    contains(point: GeoPointInterface): boolean;
    toSpan(): GeoPoint | null;
    toString(): string;
    toUrlValue(precision: number): string;
    union(other: GeoRectBounds | null): GeoRectBounds;
    expandedByDegrees(latPad: number, lonPad: number): GeoRectBounds;
}
/**
 * Creates a GeoRectBounds from two corner points
 */
declare function createGeoRectBounds(params?: {
    southWest?: GeoPoint | null;
    northEast?: GeoPoint | null;
}): GeoRectBounds;

declare function createRandomId(): string;

declare const toInt: (n: number) => number;
declare const hashStr: (s: string) => number;
/**
 * Java `Long.hashCode()` 相当: `(int)(v ^ (v >>> 32))`。
 * v は truncate（0 方向切り捨て）した 64bit 整数。座標(lat/lng/alt)×1e7 のように
 * 負値・大きな値を扱うハッシュを android-sdk / ios-sdk と一致させるために使う。
 */
declare const longHashCode: (value: number) => number;
declare const hashNum: (n: number) => number;
declare const hashBool: (b: boolean) => 1231 | 1237;
declare const hashNullable: (n: number | null | undefined) => number;
declare const hashObj: (o: unknown) => number;
declare const combineHash: (result: number, hash: number) => number;
declare const hashGeoPoint: (p: GeoPoint) => number;
declare const generateIdFromHashes: (hashes: number[]) => number;

type Unsubscribe = () => void;
type Subscriber<T> = (v: T) => void;
declare const createSubject: <T>(isEqual: (a: T, b: T) => boolean) => {
    next: (v: T) => void;
    subscribe: (fn: Subscriber<T>) => Unsubscribe;
};

interface VisibleRegion {
    bounds: GeoRectBounds;
    nearLeft: GeoPoint | null;
    nearRight: GeoPoint | null;
    farLeft: GeoPoint | null;
    farRight: GeoPoint | null;
}

/**
 * Padding applied to the map edges.
 */
interface MapPaddings {
    top: number;
    left: number;
    bottom: number;
    right: number;
}
declare namespace MapPaddings {
    const Zeros: MapPaddings;
    const from: (paddings: MapPaddings) => MapPaddings;
}
type MapPaddingsInterface = MapPaddings;
interface MapCameraPositionCopyParams {
    position?: GeoPointInterface | null;
    center?: GeoPointInterface | null;
    zoom?: number | null;
    bearing?: number | null;
    tilt?: number | null;
    visibleRegion?: VisibleRegion | null;
    paddings?: MapPaddings | null;
}
/**
 * Options for camera movement.
 */
interface CameraOptions {
    /** Duration of animation in milliseconds */
    duration?: number;
    /** Easing function for animation */
    easing?: (t: number) => number;
    /** Padding around the map in pixels */
    paddings?: MapPaddings;
    /** Backward-compatible alias used by early provider implementations */
    padding?: number | MapPaddings;
}
type MapCameraPositionInterface = {
    position: GeoPointInterface;
    zoom?: number;
    bearing?: number;
    tilt?: number;
    paddings?: MapPaddings | null;
    visibleRegion?: VisibleRegion | null;
};
/**
 * Creates a default camera position.
 */
declare function createMapCameraPosition({ position, zoom, bearing, tilt, paddings, visibleRegion, }: MapCameraPositionInterface): MapCameraPosition;
/**
 * Represents the camera position and orientation for the map view.
 */
interface MapCameraPosition {
    /** Kotlin-compatible camera target. */
    position: GeoPoint;
    /** Backward-compatible alias for position. */
    center: GeoPoint;
    /** Zoom level (typically 0-22, where higher is more zoomed in). */
    zoom: number;
    /** Bearing/rotation in degrees (0-360, where 0 is north). */
    bearing: number;
    /** Kotlin-compatible tilt in degrees. */
    tilt: number;
    visibleRegion: VisibleRegion | null;
    paddings: MapPaddings | null;
    equals(other: MapCameraPosition | null, tolerance?: number): boolean;
    copy(partial?: MapCameraPositionCopyParams): MapCameraPosition;
}
declare namespace MapCameraPosition {
    const Default: MapCameraPosition;
    function from(other: MapCameraPositionInterface): MapCameraPosition;
}

interface Offset {
    x: number;
    y: number;
}
declare function createOffset(params: {
    x: number;
    y: number;
}): Offset;

interface HexCoord {
    q: number;
    r: number;
    depth: number;
    readonly s: number;
    neighbors(): HexCoord[];
}
declare function createHexCoord({ q, r, depth, }: {
    q: number;
    r: number;
    depth?: number;
}): {
    q: number;
    r: number;
    depth: number;
    readonly s: number;
    neighbors(): HexCoord[];
};
declare function hexCoordToString(hexCoord: HexCoord): string;
declare function getNeighbors(hexCoord: HexCoord): HexCoord[];

interface HexCell {
    coord: HexCoord;
    centerLatLng: GeoPoint;
    centerXY: Offset;
    id: string;
    idPrefix(levels: number): string;
}
declare function createHexCell({ coord, centerLatLng, centerXY, id, }: {
    coord: HexCoord;
    centerLatLng: GeoPoint;
    centerXY: Offset;
    id: string;
}): HexCell;
declare function hexCellToIdPrefix(params: {
    hexCell: HexCell;
    levels: number;
}): string;

/**
 * Configuration for spatial index
 */
interface SpatialIndexConfig {
    /** Use WebAssembly implementation if available (default: true) */
    useWasm?: boolean;
    /** Zoom level for hex cell size calculation */
    zoom?: number;
    /** Base hex cell size in pixels */
    baseHexSize?: number;
}
/**
 * Spatial index interface for efficient nearest-neighbor queries
 */
interface SpatialIndex {
    /**
     * Build the spatial index from hex cells
     */
    build(cells: HexCell[]): void;
    /**
     * Find the nearest cell to a query point
     */
    findNearest(query: Offset): HexCell | null;
    /**
     * Find k nearest cells
     */
    findKNearest(query: Offset, k: number): HexCell[];
    /**
     * Find all cells within a radius
     */
    findWithinRadius(query: Offset, radius: number): HexCell[];
    /**
     * Check if the index is empty
     */
    isEmpty(): boolean;
    /**
     * Clean up resources
     */
    dispose(): void;
}

interface AttributionRule {
    attribution: string;
    minZoom?: number;
    maxZoom?: number;
    bounds?: GeoRectBounds;
}
declare function resolveAttributionRules(rules: readonly AttributionRule[], camera: MapCameraPosition): string[];

/**
 * Base interface for map design types (style / map type).
 * Mirrors Android MapDesignTypeInterface<T> / iOS MapDesignTypeProtocol.
 *
 * T is String for MapLibre (style URL), String for Google Maps JS (map type id string).
 * Note: Android Google Maps uses Int for T; TypeScript uses string because
 * the Google Maps JS API identifies map types as strings ('roadmap', 'satellite', etc.).
 */
interface MapDesignTypeInterface<T> {
    readonly id: T;
    readonly attributionRules?: readonly AttributionRule[];
    getValue(): T;
}

/**
 * 地図面を描くときの投影法。
 *
 * android-sdk の `enum class MapProjection { Mercator, Globe }` /
 * ios-sdk の `enum MapProjection { case mercator, globe }` と同じ契約。
 * 値は Android の case 名に合わせてある。
 *
 * 対応プロバイダは web では mapbox / maplibre / maptiler の 3 つ。
 * HERE は JS SDK v3 が globe を持たないため mercator 固定（HereMapView2D.web.tsx の
 * コメント参照）。他は投影法が固定のため、このプロパティを受け取らない。
 */
declare enum MapProjection {
    Mercator = "Mercator",
    Globe = "Globe"
}

/**
 * カメラの可動範囲を制限する設定。
 *
 * - `bounds` : カメラ（ビューポート）がこの矩形の外へ出られないように制限する。null で無制限。
 * - `minZoom` / `maxZoom` : ズームの下限・上限。値は統一ズーム（Google Maps 準拠, 0..22 相当）で
 *   指定し、各プロバイダが自身のズーム体系へ変換して適用する。null で無制限。
 *
 * android-sdk の `CameraRestriction`（core/map/CameraRestriction.kt）に対応する。
 *
 * 適用方式はプロバイダによって2通りある（android-sdk と同じ振り分け）:
 * - ネイティブの範囲制限 API を持つもの（Mapbox / MapLibre / MapTiler / TomTom / Google /
 *   Leaflet / OpenLayers / Azure Maps）: `setCameraRestriction` をオーバーライドして直接適用する。
 * - 持たないもの（HERE / ArcGIS / MapKit / Cesium）: カメラ停止時に
 *   `BaseMapViewController.cameraRestrictionCorrection()` で中心座標・ズームを矩形内へ
 *   クランプして再適用する。
 */
interface CameraRestriction {
    bounds?: GeoRectBounds | null;
    minZoom?: number | null;
    maxZoom?: number | null;
}
/** 制限が実質的に無い（= 適用しても何も起きない）場合に true。 */
declare function isEmptyCameraRestriction(restriction: CameraRestriction | null | undefined): boolean;
/** android-sdk の `CameraRestriction.None` に対応する。 */
declare const NoCameraRestriction: CameraRestriction;
/**
 * `restrictBounds` / `minZoom` / `maxZoom` という個別 prop 形式を `CameraRestriction` に正規化する。
 *
 * react-for-* は歴史的に3つの独立した prop としてマップ生成時 config に渡していた。
 * 両方の形を受けられるようにして、既存利用側を壊さずに core へ集約するためのヘルパー。
 * 両方指定された場合は `cameraRestriction` を優先する。
 */
declare function resolveCameraRestriction(params: {
    cameraRestriction?: CameraRestriction | null;
    restrictBounds?: GeoRectBounds | null;
    minZoom?: number | null;
    maxZoom?: number | null;
}): CameraRestriction | null;

type ScreenOffsetResult = Offset | null | Promise<Offset | null>;
interface MapViewHolder<ActualMapView, ActualMap> {
    mapView: ActualMapView;
    map: ActualMap;
    toScreenOffset(position: GeoPointInterface): ScreenOffsetResult;
    fromScreenOffset(offset: Offset): Promise<GeoPoint | null>;
    fromScreenOffsetSync(offset: Offset): GeoPoint | null;
}
declare abstract class MapViewHolderBase<ActualMapView, ActualMap> implements MapViewHolder<ActualMapView, ActualMap> {
    abstract mapView: ActualMapView;
    abstract map: ActualMap;
    abstract toScreenOffset(position: GeoPointInterface): ScreenOffsetResult;
    /**
     * Default async wrapper over the synchronous path. Holders whose provider
     * only offers an asynchronous projection API override this.
     */
    fromScreenOffset(offset: Offset): Promise<GeoPoint | null>;
    fromScreenOffsetSync(_offset: Offset): GeoPoint | null;
}

/**
 * Which map gestures the user is allowed to perform.
 *
 * Mirrors `MapUISettings` on Android and iOS. Every flag defaults to `true`, so
 * the default value leaves the provider's own behaviour untouched.
 *
 * Not every provider can honour every flag. Some map engines bundle two gestures
 * into one handler, and Leaflet, OpenLayers and the HERE 2D web view fake bearing
 * and tilt with a CSS transform — there is no rotate or tilt *gesture* there to
 * switch off. Setting an unsupported flag to `false` is ignored and logs a
 * one-time warning; see {@link MapUISettingsDiagnostics}.
 */
interface MapUISettings {
    /** Pan / drag the map. */
    scrollGesture: boolean;
    /** Wheel, pinch and double-click zoom. */
    zoomGesture: boolean;
    /** Rotate the map (change bearing). */
    rotateGesture: boolean;
    /** Tilt the map (change pitch). */
    tiltGesture: boolean;
}
/**
 * `MapUISettings.Default` / `MapUISettings.None` を提供する名前空間。
 *
 * android-sdk / ios-sdk の companion object（`MapUISettings.Default` / `.None`）に対応する。
 * TypeScript には companion object が無いので、interface と同名の const を宣言マージして
 * 型位置と値位置の両方で `MapUISettings` を使えるようにしている
 * （`DefaultMarkerIcon.ts` が Kotlin の typealias に対して使っているのと同じ手法）。
 */
declare const MapUISettings: {
    /** All gestures enabled — the default. */
    readonly Default: Readonly<MapUISettings>;
    /** Every gesture disabled; the map becomes non-interactive. */
    readonly None: Readonly<MapUISettings>;
};
/** Fills in any omitted flag with the default (`true`). */
declare function resolveMapUISettings(settings?: Partial<MapUISettings> | null): MapUISettings;
/** The gestures {@link MapUISettings} can turn on and off. */
type MapGesture = 'scroll' | 'zoom' | 'rotate' | 'tilt';
/**
 * Reports gesture flags a provider cannot honour.
 *
 * Providers call {@link warnIfRequested} when a flag is set to `false` that their
 * map engine has no way to disable. Warnings are logged once per provider+gesture
 * so a component that re-renders on every camera move does not flood the console.
 */
declare const MapUISettingsDiagnostics: {
    /**
     * Logs once if `requested` is `false` — i.e. the app asked to disable a
     * gesture this provider cannot disable. A `true` value needs no warning,
     * because leaving a gesture enabled is always achievable.
     */
    warnIfRequested(requested: boolean, gesture: MapGesture, provider: string, reason: string): void;
    /** Test hook — forget which warnings have already been logged. */
    resetWarnings(): void;
};

/**
 * `BaseMapViewController` のオーバーレイレジストリが必要とする最小の構造。
 *
 * `OverlayController` は状態/エンティティ/イベントの3型でパラメータ化されているため、
 * 異なるオーバーレイ種別を1つの配列に入れられない。android-sdk の
 * `OverlayControllerInterface<*, *>` によるスター射影に相当するものとして、
 * レジストリが実際に呼ぶメンバだけを非ジェネリックに切り出す。
 */
interface OverlayControllerLike {
    onCameraChanged?(mapCameraPosition: MapCameraPosition): Promise<void> | void;
    destroy?(): void;
}
interface OverlayController<StateType, EntityType, EventType> {
    readonly zIndex: number;
    clickListener: ((event: EventType) => void) | null;
    add(data: StateType[]): Promise<void>;
    update(state: StateType): Promise<void>;
    clear(): Promise<void>;
    find(position: GeoPoint): EntityType | null;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> | void;
    /**
     * Cleanup resources when the controller is no longer needed.
     * IMPORTANT: Call this when switching map providers or disposing the map.
     */
    destroy(): void;
}

/**
 * Configuration options for initializing a map
 */
interface MapConfig {
    /** Container element for the map */
    container: HTMLElement | string;
    /** API key or access token for the map provider */
    apiKey?: string;
    /**
     * Additional provider-specific options. Deliberately typed as `Record<string,
     * any>`: provider configs extend MapConfig and NARROW this to their own
     * option interface (e.g. LeafletConfig -> Leaflet's `MapOptions`), which is
     * only assignable when the base is permissive. `Record<string, unknown>` would
     * break that subtyping (TS2430), so `any` is intentional here.
     */
    options?: Record<string, any>;
    initCameraPosition: MapCameraPosition;
}
/**
 * Abstract base class for map providers
 */
declare abstract class MapProvider {
    protected controller: MapViewControllerInterface | null;
    /**
     * Initialize the map provider
     */
    abstract initialize(config: MapConfig): Promise<MapViewControllerInterface>;
    /**
     * Get the current controller instance
     */
    getController(): MapViewControllerInterface | null;
    /**
     * Check if the provider is initialized
     */
    isInitialized(): boolean;
    /**
     * Clean up resources
     */
    abstract destroy(): void;
}
/**
 * Map provider types
 */
declare enum MapProviderType {
    GOOGLE_MAPS = "google-maps",
    MAPLIBRE = "maplibre",
    MAPBOX = "mapbox",
    HERE = "here",
    ARCGIS = "arcgis"
}

type OnMapLoadedHandler<TState> = (state: TState) => void;
type OnMapEventHandler = (point: GeoPoint) => void;
type OnCameraMoveHandler = (camera: MapCameraPosition) => void;
/**
 * Common props that every map-view component must accept.
 * Extend this interface in SDK-specific packages to add platform-specific props
 * (e.g. apiKey for Google Maps, style URL for MapLibre).
 */
interface MapViewBaseProps<TState extends MapViewStateInterface<MapDesignTypeInterface<unknown>>> {
    state: TState;
    onMapLoaded?: OnMapLoadedHandler<TState>;
    onMapClick?: OnMapEventHandler;
    onMapLongClick?: OnMapEventHandler;
    onCameraMoveStart?: OnCameraMoveHandler;
    onCameraMove?: OnCameraMoveHandler;
    onCameraMoveEnd?: OnCameraMoveHandler;
    className?: string;
    /**
     * カメラの可動範囲（パン範囲・ズーム上下限）を制限する。
     *
     * android-sdk の各 *MapView コンポーザブルが受け取る `cameraRestriction` 引数に対応する。
     * 個別の `restrictBounds` / `minZoom` / `maxZoom` prop も引き続き受け付けるが、
     * そちらはマップ生成時にしか反映されない。実行時に変更したい場合はこちらを使う。
     */
    cameraRestriction?: CameraRestriction | null;
}
/**
 * Abstract base for map-view implementations.
 *
 * Mirrors Android's MapViewBase and enforces the three-step initialization
 * contract that every new map SDK module must provide:
 *   1. sdkInitialize  — load the SDK (e.g. inject a script tag)
 *   2. createHolder   — wrap the native map in a MapViewHolder
 *   3. createController — wrap the holder in a map view controller
 *
 * Android equivalent: MapViewBase.kt (sdkInitialize / holderProvider / controllerProvider)
 * iOS equivalent:     Each view's Coordinator.bind() in MapConductorCore
 */
declare abstract class MapViewBase<TState extends MapViewStateInterface<MapDesignTypeInterface<unknown>>, THolder extends MapViewHolder<unknown, unknown>, TController extends MapViewControllerInterface> {
    /** Load the underlying map SDK. Return false to abort initialization. */
    protected abstract sdkInitialize(): Promise<boolean>;
    /** Build the SDK-specific config from the view state (camera position, design type, etc.). */
    protected abstract buildConfig(state: TState, container: HTMLElement): MapConfig;
    /** Create a holder that wraps the native map view instance. */
    protected abstract createHolder(container: HTMLElement): Promise<THolder>;
    /** Create the controller that exposes the MapConductor API. */
    protected abstract createController(holder: THolder): Promise<TController>;
}

type OnMapInitializedHandler = () => void;
/**
 * Core controller interface that all map SDK modules must implement.
 * Mirrors Android MapViewControllerInterface / iOS MapViewControllerProtocol.
 */
interface MapViewControllerInterface {
    readonly holder: MapViewHolder<unknown, unknown>;
    clearOverlays(): Promise<void>;
    setCameraMoveStartListener(listener: OnCameraMoveHandler | null): void;
    setCameraMoveListener(listener: OnCameraMoveHandler | null): void;
    setCameraMoveEndListener(listener: OnCameraMoveHandler | null): void;
    setMapClickListener(listener: OnMapEventHandler | null): void;
    setMapLongClickListener(listener: OnMapEventHandler | null): void;
    setMapInitializedListener(listener: OnMapInitializedHandler | null): void;
    moveCamera(position: MapCameraPosition): Promise<boolean>;
    /**
     * カメラをアニメーションで移動する。
     *
     * 引数は android-sdk の `animateCamera(position, duration: Long)` に揃えてある。
     * 以前は `CameraOptions` を受けていたが、実際に読まれていたのは `duration` だけで、
     * `easing` はどのプロバイダも見ておらず、`paddings` は `padding` の別名として
     * フォールバックされるだけだった。
     *
     * 戻り値が `Promise` なのは Kotlin の `Unit` / Swift の `Void` に対する TS 側の
     * 言い方の違いで、`clearOverlays()` が `suspend fun` に対して `Promise<void>` なのと同じ。
     */
    animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;
    /**
     * Applies the gesture flags to the underlying map engine.
     *
     * Optional the same way Android's `applyUISettings` has an empty default body:
     * a provider that has not been wired up yet simply leaves the map as it is.
     */
    applyUISettings?(settings: MapUISettings): void;
    /**
     * カメラの可動範囲（パン範囲・ズーム上下限）を制限する。null または空の
     * `CameraRestriction` で制限解除。
     *
     * ネイティブに範囲制限 API を持つプロバイダは直接適用し、持たないプロバイダは
     * `BaseMapViewController.cameraRestrictionCorrection()` によるクランプで実現する。
     * ズームは統一ズーム（Google 準拠）で指定し、各プロバイダが自身の体系へ変換する。
     *
     * `applyUISettings` と同じく optional: 未対応のプロバイダはマップをそのままにする。
     */
    setCameraRestriction?(restriction: CameraRestriction | null): void;
    /**
     * オーバーレイコントローラを登録する。登録先にはカメラ変更が伝播し、`destroy()` で
     * 一括破棄される。`BaseMapViewController` が実装を提供する。
     */
    registerOverlayController?(controller: OverlayControllerLike): void;
    /** 登録を解除する。`BaseMapViewController` が実装を提供する。 */
    unregisterOverlayController?(controller: OverlayControllerLike): void;
    /**
     * 範囲が収まるようにカメラを合わせる。
     * 引数は android-sdk の `fitBounds(bounds, padding: Int)` に揃えてある。
     */
    fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;
    destroy(): void;
}

/**
 * Typed key for registering and retrieving map-scoped services (plugins).
 * Mirrors `MapServiceKey` from `MapServiceRegistry.kt`.
 */
interface MapServiceKey<T> {
    readonly __brand: T;
}
declare function createMapServiceKey<T>(): MapServiceKey<T>;
interface MapServiceRegistry {
    get<T>(key: MapServiceKey<T>): T | null;
}
declare class MutableMapServiceRegistry implements MapServiceRegistry {
    private readonly services;
    put<T>(key: MapServiceKey<T>, value: T): void;
    get<T>(key: MapServiceKey<T>): T | null;
    /**
     * 登録済みのサービスを1件だけ取り消す。未登録のキーを渡しても何も起きない。
     *
     * {@link clear} がレジストリ全体を空にするのに対し、こちらは他の capability を
     * 残したまま1つだけ取り下げたいプラグイン向け。android-sdk の
     * `MutableMapServiceRegistry.remove` / ios-sdk の `remove(_:)` と同じ意味論。
     */
    remove<T>(key: MapServiceKey<T>): void;
    clear(): void;
}
declare const EmptyMapServiceRegistry: MapServiceRegistry;

interface MapViewStateInterface<ActualMapDesignType extends MapDesignTypeInterface<unknown>> {
    readonly id: string;
    /**
     * 現在のカメラ。**カメラを読む正規の経路はここ**で、表示範囲は
     * `cameraPosition.visibleRegion.bounds` から取る。
     *
     * プロバイダが地図 SDK のカメライベントごとに `updateCameraPosition()` で
     * push する（初期化直後にも 1 回 push される）。変化を追いたい場合は
     * `onCameraMove` / `onCameraMoveEnd`、拡張モジュールは登録した
     * オーバーレイコントローラの `onCameraChanged` を使う。
     *
     * コントローラ側に `getCameraPosition()` / `getBounds()` を足さないこと。
     * 理由は `MapViewControllerInterface` のコメントと /docs/reading-camera を参照。
     */
    readonly cameraPosition: MapCameraPosition;
    mapDesignType: ActualMapDesignType;
    /**
     * このマップにスコープされたサービス（プラグイン）のレジストリ。
     *
     * プロバイダが capability を登録し、拡張モジュール（marker-clustering など）が解決する。
     * これによりプロバイダはプラグインのインタフェースを実装せずに済み、プラグインは
     * どのプロバイダ上で動いているかを知らずに済む。
     * ios-sdk の `MapViewState.serviceRegistry` と同じ位置づけで、React では
     * `MapServiceRegistryProvider` が `useMapServiceRegistry()` へ供給する
     * （android-sdk の `LocalMapServiceRegistry` CompositionLocal に相当）。
     */
    readonly serviceRegistry: MutableMapServiceRegistry;
    /** Which map gestures the user may perform. See {@link MapUISettings}. */
    uiSettings: MapUISettings;
    moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
    moveCameraTo(position: GeoPoint, durationMillis?: number): void;
    fitBounds(bounds: GeoRectBounds, padding?: number): void;
    getMapViewHolder(): MapViewHolder<unknown, unknown> | null;
}
/**
 * プロバイダのビューと `js-sdk-react` だけが使う内部配線。**公開 API ではない。**
 *
 * ここにある 4 つはアプリから呼ぶものではない（呼ぶと押し込んだ値と地図の実態がずれる）。
 * 公開インタフェース {@link MapViewStateInterface} には出さず、SDK 内部からは
 * {@link mapViewStateInternal} を通して取り出す。
 *
 * android-sdk / ios-sdk では同じものが具象クラスの internal / 非 public として隠れている
 * （ビューが具象クラスを受け取るため）。React はビューがインタフェース越しに state を
 * 受け取るので、こうして型を分けないと公開面に出てしまう。
 */
interface MapViewStateInternal {
    /**
     * プロバイダのビューが、コントローラの準備完了時（アンマウント時は null）に呼ぶ。
     * MapConductor の React コンポーネント（LeafletMapView, GoogleMapView, ...）が
     * 内部で使っている共通の接続点。
     */
    setController(controller: MapViewControllerInterface | null): void;
    /** プロバイダのビューが、地図 SDK のカメラ移動イベントごとに現在値を押し込む。 */
    updateCameraPosition(camera: MapCameraPosition): void;
    /** カメラ変化で再レンダリングするためにプロバイダのビューが購読する。 */
    setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void;
    /**
     * `uiSettings` への代入をエンジンへ伝えるために `useMapUISettings` が購読する。
     *
     * state を持たないコンポーネントはフィールド代入では再レンダリングできないため、
     * ポーリングではなく push する（Android の `mutableStateOf` / iOS の `@Published` が
     * 暗黙にやっていることを手で書いている）。
     */
    setUISettingsChangeListener(listener: ((settings: MapUISettings) => void) | null): void;
}
/**
 * 公開 state から内部配線（{@link MapViewStateInternal}）を取り出す。
 *
 * **プロバイダのビューと `js-sdk-react` の専用**。アプリから呼ばないこと。
 * 実装は必ず {@link MapViewState} を継承しているので、実行時は常に成立する。
 */
declare function mapViewStateInternal(state: MapViewStateInterface<MapDesignTypeInterface<unknown>>): MapViewStateInternal;
declare abstract class MapViewState<ActualMapDesignType extends MapDesignTypeInterface<unknown>> implements MapViewStateInterface<ActualMapDesignType>, MapViewStateInternal {
    protected readonly tag: string;
    abstract readonly id: string;
    abstract readonly cameraPosition: MapCameraPosition;
    abstract mapDesignType: ActualMapDesignType;
    /** @see MapViewStateInterface.serviceRegistry */
    readonly serviceRegistry: MutableMapServiceRegistry;
    private _uiSettings;
    private _uiSettingsChangeListener;
    get uiSettings(): MapUISettings;
    set uiSettings(value: MapUISettings);
    setUISettingsChangeListener(listener: ((settings: MapUISettings) => void) | null): void;
    abstract moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
    abstract moveCameraTo(position: GeoPoint, durationMillis?: number): void;
    abstract fitBounds(bounds: GeoRectBounds, padding?: number): void;
    abstract getMapViewHolder(): MapViewHolder<unknown, unknown> | null;
    abstract setController(controller: MapViewControllerInterface | null): void;
    abstract updateCameraPosition(camera: MapCameraPosition): void;
    abstract setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void;
}

interface FitBoundsCameraResult {
    center: GeoPoint;
    /** Unified (Google-style, 256px tile) zoom level. */
    zoom: number;
}
declare function computeFitBoundsCameraPosition({ bounds, viewportWidthPx, viewportHeightPx, padding, bearing, tileSize, }: {
    bounds: GeoRectBounds;
    viewportWidthPx: number;
    viewportHeightPx: number;
    /** Inset in pixels applied on every side. */
    padding?: number;
    /** Map bearing in degrees; the fit accounts for a rotated viewport. */
    bearing?: number;
    tileSize?: number;
}): FitBoundsCameraResult | null;

interface MapOverlayInterface<DataType> {
    subscribe(fn: (data: ReadonlyMap<string, DataType>) => void): () => void;
    render(data: ReadonlyMap<string, DataType>, controller: MapViewControllerInterface): Promise<void>;
}
declare class MapOverlayRegistry {
    private readonly overlays;
    register(overlay: MapOverlayInterface<unknown>): void;
    getAll(): MapOverlayInterface<unknown>[];
}

/** Map initialization lifecycle states. Mirrors `InitState` from `MapViewState.kt`. */
declare enum InitState {
    NotStarted = "NotStarted",
    Initializing = "Initializing",
    SdkInitialized = "SdkInitialized",
    MapViewCreated = "MapViewCreated",
    MapCreating = "MapCreating",
    MapCreated = "MapCreated",
    MapLoaded = "MapLoaded",
    Failed = "Failed"
}

/**
 * Marker animation types
 */
declare enum MarkerAnimation {
    /** Marker drops from the sky */
    Drop = "Drop",
    /** Marker bounces */
    Bounce = "Bounce"
}

interface MarkerEntity<ActualMarker> {
    marker: ActualMarker | null;
    state: MarkerState;
    fingerPrint: MarkerFingerPrint;
    visible: boolean;
    isRendered: boolean;
    /**
     * タイル描画されるマーカーかどうか。
     *
     * android-sdk / ios-sdk の `MarkerEntity.tiling` に対応する。以前は「タイル済み」を
     * `marker === null` で表現していたが、それだとプロバイダの `onAdd` が失敗して null を
     * 返したエンティティまでタイル扱いになってしまうため、明示的なフラグを持つ。
     */
    tiling: boolean;
}
declare const createMarkerEntity: <ActualMarker>(params: {
    marker: ActualMarker | null;
    state: MarkerState;
    visible?: boolean;
    isRendered?: boolean;
    tiling?: boolean;
}) => MarkerEntity<ActualMarker>;

/**
 * A single marker animation request handed off to a screen-space overlay
 * layer instead of being played by mutating the provider's native marker.
 *
 * Mirrors Android's `MarkerAnimationOverlayEntry` (compose/marker):
 * the overlay animates `bitmapIcon` in screen space above the map view and
 * below InfoBubbles, re-projecting `state.position` every frame so the
 * animation tracks camera movement/tilt/rotation correctly.
 */
interface MarkerAnimationOverlayEntry {
    id: string;
    state: MarkerState;
    bitmapIcon: BitmapIcon;
    animation: MarkerAnimation;
    durationMillis: number;
    onFinished: () => void;
}
/**
 * Implemented by the view layer (e.g. a React component) that owns the
 * screen-space canvas/DOM overlay. Renderers call `host(entry)` to start
 * an animation instead of interpolating geographic coordinates themselves.
 */
type MarkerAnimationOverlayHost = (entry: MarkerAnimationOverlayEntry) => void;
/**
 * Ports Android's `BounceInterpolator` easing curve so overlay-driven and
 * legacy geo-interpolated bounce animations look identical.
 */
declare const bounceInterpolation: (time: number) => number;

type OnMarkerEventHandler = (state: MarkerState) => void;

interface BitmapIcon {
    url: string;
    anchor: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
}
interface AddParams {
    state: MarkerState;
    bitmapIcon: BitmapIcon;
}
interface ChangeParams<ActualMarker> {
    current: MarkerEntity<ActualMarker>;
    bitmapIcon: BitmapIcon;
    prev: MarkerEntity<ActualMarker>;
}
interface MarkerOverlayRenderer<ActualMarker> {
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
    onAdd(data: AddParams[]): Promise<(ActualMarker | null)[]>;
    onChange(data: ChangeParams<ActualMarker>[]): Promise<(ActualMarker | null)[]>;
    onRemove(data: MarkerEntity<ActualMarker>[]): Promise<void>;
    onAnimate(entity: MarkerEntity<ActualMarker>): Promise<void>;
    onPostProcess(): Promise<void>;
    /** Toggle native marker visibility while a screen-space overlay animation is playing. */
    setMarkerVisible(entity: MarkerEntity<ActualMarker>, visible: boolean): void;
}

interface MarkerIcon {
    scale: number;
    anchor: Offset;
    iconSize: number;
    infoAnchor: Offset;
    debug: boolean;
    toBitmapIcon(): BitmapIcon;
}
declare abstract class AbstractMarkerIcon implements MarkerIcon {
    abstract scale: number;
    abstract anchor: Offset;
    abstract iconSize: number;
    abstract infoAnchor: Offset;
    abstract debug: boolean;
    abstract toBitmapIcon(): BitmapIcon;
    /**
     * デバッグ用の枠描画
     */
    protected drawDebugFrame(canvas: HTMLCanvasElement | CanvasRenderingContext2D): void;
}

interface MarkerFingerPrint {
    id: number;
    icon: number;
    clickable: number;
    draggable: number;
    latitude: number;
    longitude: number;
    animation: number;
    zIndex: number;
}
type MarkerFingerPrintState = {
    id: string;
    icon: MarkerIcon | null;
    clickable: boolean;
    draggable: boolean;
    position: GeoPoint;
    /** null は「未指定」。MarkerState.zIndex と同じく android-sdk の `Int?` に対応する。 */
    zIndex: number | null;
    getAnimation(): MarkerAnimation | null;
};
declare function markerIconHashCode(icon: MarkerIcon | null): number;
declare const createFingerPrint: (state: MarkerFingerPrintState) => MarkerFingerPrint;
declare function createMarkerFingerPrint(state: MarkerFingerPrintState): MarkerFingerPrint;
declare function createMarkerFingerPrint(params: {
    id: string;
    icon: MarkerIcon | null;
    clickable: boolean;
    draggable: boolean;
    position: GeoPoint;
    animation: MarkerAnimation | null;
    zIndex?: number | null;
}): MarkerFingerPrint;

type Serializable = string | number | boolean | null | {
    [key: string]: unknown;
} | unknown[];
interface MarkerState {
    position: GeoPoint;
    readonly id: string;
    extra: Serializable | null;
    icon: MarkerIcon | null;
    animation: MarkerAnimation | null;
    clickable: boolean;
    draggable: boolean;
    /**
     * 描画順。null は「未指定」で、0 とは意味が違う（android-sdk / ios-sdk は `Int?` 既定 null）。
     * 以前は number 固定で null を 0 に潰していたため、未指定と明示的な 0 を区別できなかった。
     */
    zIndex: number | null;
    onClick: OnMarkerEventHandler | null;
    onDragStart: OnMarkerEventHandler | null;
    onDrag: OnMarkerEventHandler | null;
    onDragEnd: OnMarkerEventHandler | null;
    onAnimateStart: OnMarkerEventHandler | null;
    onAnimateEnd: OnMarkerEventHandler | null;
    animate(animation: MarkerAnimation | null): void;
    getAnimation(): MarkerAnimation | null;
    setPosition(position: GeoPoint): void;
    setIcon(icon: MarkerIcon | null): void;
    setClickable(clickable: boolean): void;
    setDraggable(draggable: boolean): void;
    setZIndex(zIndex: number | null): void;
    copy(opts?: MarkerStateCopyParams): MarkerState;
    equals(other: unknown): boolean;
    hashCode(): number;
    fingerPrint(): MarkerFingerPrint;
    asObservable(): {
        subscribe: (fn: (fingerPrint: MarkerFingerPrint) => void) => () => void;
    };
}
interface MarkerStateCopyParams {
    id?: string | null;
    position?: GeoPoint;
    extra?: Serializable | null;
    icon?: MarkerIcon | null;
    animation?: MarkerAnimation | null;
    zIndex?: number | null;
    clickable?: boolean | null;
    draggable?: boolean | null;
    onClick?: OnMarkerEventHandler | null;
    onDragStart?: OnMarkerEventHandler | null;
    onDrag?: OnMarkerEventHandler | null;
    onDragEnd?: OnMarkerEventHandler | null;
    onAnimateStart?: OnMarkerEventHandler | null;
    onAnimateEnd?: OnMarkerEventHandler | null;
}
interface CreateMarkerStateParams {
    position: GeoPoint;
    id?: string | null;
    extra?: Serializable | null;
    icon?: MarkerIcon | null;
    animation?: MarkerAnimation | null;
    zIndex?: number | null;
    clickable?: boolean;
    draggable?: boolean;
    onClick?: OnMarkerEventHandler | null;
    onDragStart?: OnMarkerEventHandler | null;
    onDrag?: OnMarkerEventHandler | null;
    onDragEnd?: OnMarkerEventHandler | null;
    onAnimateStart?: OnMarkerEventHandler | null;
    onAnimateEnd?: OnMarkerEventHandler | null;
}
declare function createMarkerState(params: CreateMarkerStateParams): MarkerState;
declare const fingerPrintEquals: (left: MarkerFingerPrint, right: MarkerFingerPrint) => boolean;

interface CircleFingerPrint {
    id: number;
    center: number;
    radiusMeters: number;
    clickable: number;
    geodesic: number;
    strokeColor: number;
    strokeWidth: number;
    fillColor: number;
    zIndex: number;
    extra: number;
}
interface CircleEvent {
    state: CircleState;
    clicked: GeoPoint;
}
type OnCircleEventHandler = (event: CircleEvent) => void;
interface CircleState {
    readonly id: string;
    center: GeoPoint;
    radiusMeters: number;
    geodesic: boolean;
    clickable: boolean;
    strokeColor: string;
    strokeWidth: number;
    fillColor: string;
    extra: Serializable | null;
    zIndex: number | null;
    onClick: OnCircleEventHandler | null;
    fingerPrint(): CircleFingerPrint;
    copy(opts?: CircleStateCopyParams): CircleState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): {
        subscribe: (fn: (fp: CircleFingerPrint) => void) => () => void;
    };
}
interface CircleStateCopyParams {
    center?: GeoPoint;
    radiusMeters?: number;
    geodesic?: boolean;
    clickable?: boolean;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    extra?: Serializable | null;
    zIndex?: number | null;
    onClick?: OnCircleEventHandler | null;
    id?: string | null;
}
declare function createCircleState(params: {
    center: GeoPoint;
    radiusMeters: number;
    geodesic?: boolean;
    clickable?: boolean;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    extra?: Serializable | null;
    zIndex?: number | null;
    onClick?: OnCircleEventHandler | null;
    id?: string | null;
}): CircleState;

interface CircleEntity<ActualCircle> {
    circle: ActualCircle;
    readonly state: CircleState;
    readonly fingerPrint: CircleFingerPrint;
}
declare const createCircleEntity: <ActualCircle>(params: {
    circle: ActualCircle;
    state: CircleState;
}) => CircleEntity<ActualCircle>;

interface CircleAddParams {
    readonly state: CircleState;
}
interface CircleChangeParams<ActualCircle> {
    readonly current: CircleEntity<ActualCircle>;
    readonly prev: CircleEntity<ActualCircle>;
}
interface CircleOverlayRenderer<ActualCircle> {
    onAdd(data: CircleAddParams[]): Promise<(ActualCircle | null)[]>;
    onChange(data: CircleChangeParams<ActualCircle>[]): Promise<(ActualCircle | null)[]>;
    onRemove(data: CircleEntity<ActualCircle>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

declare abstract class AbstractCircleOverlayRenderer<MapViewHolderType extends MapViewHolder<unknown, unknown>, ActualCircle> implements CircleOverlayRenderer<ActualCircle> {
    readonly holder: MapViewHolderType;
    constructor(holder: MapViewHolderType);
    abstract removeCircle(entity: CircleEntity<ActualCircle>): Promise<void>;
    abstract createCircle(state: CircleState): Promise<ActualCircle | null>;
    abstract updateCircleProperties(params: {
        circle: ActualCircle;
        current: CircleEntity<ActualCircle>;
        prev: CircleEntity<ActualCircle>;
    }): Promise<ActualCircle | null>;
    onAdd(data: CircleAddParams[]): Promise<(ActualCircle | null)[]>;
    onChange(data: CircleChangeParams<ActualCircle>[]): Promise<(ActualCircle | null)[]>;
    onRemove(data: CircleEntity<ActualCircle>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

interface CircleCapable {
    compositionCircles(data: CircleState[]): Promise<void>;
    updateCircle(state: CircleState): Promise<void>;
    /** @deprecated Use CircleState.onClick instead. */
    setOnCircleClickListener(listener: OnCircleEventHandler | null): void;
    hasCircle(state: CircleState): boolean;
}

interface CircleManagerInterface<ActualCircle> {
    registerEntity(entity: CircleEntity<ActualCircle>): void;
    removeEntity(id: string): CircleEntity<ActualCircle> | null;
    getEntity(id: string): CircleEntity<ActualCircle> | null;
    hasEntity(id: string): boolean;
    allEntities(): CircleEntity<ActualCircle>[];
    clear(): void;
    find(position: GeoPoint): CircleEntity<ActualCircle> | null;
    updateEntity(entity: CircleEntity<ActualCircle>): void;
}
declare class CircleManager<ActualCircle> implements CircleManagerInterface<ActualCircle> {
    private readonly entities;
    getEntity(id: string): CircleEntity<ActualCircle> | null;
    hasEntity(id: string): boolean;
    removeEntity(id: string): CircleEntity<ActualCircle> | null;
    registerEntity(entity: CircleEntity<ActualCircle>): void;
    updateEntity(entity: CircleEntity<ActualCircle>): void;
    allEntities(): CircleEntity<ActualCircle>[];
    clear(): void;
    find(position: GeoPoint): CircleEntity<ActualCircle> | null;
}

declare abstract class CircleController<ActualCircle> implements OverlayController<CircleState, CircleEntity<ActualCircle>, CircleEvent> {
    readonly zIndex: number;
    readonly circleManager: CircleManagerInterface<ActualCircle>;
    readonly renderer: CircleOverlayRenderer<ActualCircle>;
    clickListener: OnCircleEventHandler | null;
    private semaphore;
    constructor({ circleManager, renderer, clickListener, }: {
        circleManager: CircleManagerInterface<ActualCircle>;
        renderer: CircleOverlayRenderer<ActualCircle>;
        clickListener?: OnCircleEventHandler | null;
    });
    dispatchClick(event: CircleEvent): void;
    composition(data: CircleState[]): Promise<void>;
    has(state: CircleState): boolean;
    setOnClickListener(listener: OnCircleEventHandler | null): void;
    add(data: CircleState[]): Promise<void>;
    update(state: CircleState): Promise<void>;
    clear(): Promise<void>;
    find(position: GeoPoint): CircleEntity<ActualCircle> | null;
    onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void>;
    destroy(): void;
}

/**
 * Per-map, per-overlay-type source of truth for overlay states.
 *
 * 変更の届け方は 3 プラットフォームで揃えてある。
 *
 * - **membership（add / remove）は debounce**。5ms の無入力窓で、イベントが来るたびに
 *   窓を延長し、件数が閾値に達したら待たずに出す。android-sdk の
 *   `debounceBatch(5ms, 100/300)`、ios-sdk の `scheduleMembership()` と同じ。
 * - **in-place 変更は sample**。1 つの state につき 1 窓 1 回、最新の値だけを配る。
 *   android-sdk の `sample(updateDebounce)`、ios-sdk の `scheduleUpdate()` と同じ。
 *
 * どちらの窓でも、コレクション自体の書き換えは同期のまま（`values()` / `get()` は常に
 * 最新）。遅らせるのは購読者・ハンドラへの通知だけ。
 */
declare class OverlayCollector<S extends {
    id: string;
}> {
    private readonly map;
    private readonly subs;
    private updateHandler;
    private readonly updateSubs;
    private batchDepth;
    private batchDirty;
    private pendingAdds;
    private pendingRemoves;
    private flushTimer;
    private readonly pendingUpdates;
    private updateTimer;
    /**
     * `<Marker>` を1つマウントするたびに1回ずつ走っていた composition を、
     * android-sdk の OverlayCollector と同じ窓でまとめる。
     *
     * コレクション自体の書き換えは同期のまま（`values()` / `get()` は常に最新）で、
     * 遅らせるのは購読者への通知だけ。`applyDiff` / `replaceAll` / `clear` は
     * もともと1回しか通知しないバルク操作なので、android-sdk と同じくデバウンス対象外。
     */
    add(state: S): void;
    remove(id: string): void;
    /**
     * Applies a batch of upserts and removals with a single notification.
     * Unlike calling add()/remove() in a loop (which notifies subscribers once
     * per call and can trigger an expensive downstream re-render each time),
     * subscribers see the final state exactly once.
     */
    applyDiff(upserts: S[], removeIds: Iterable<string>): void;
    /**
     * Applies a group of collection and state mutations as one composition.
     *
     * `<Markers states={...}>` は毎レンダーで「既存 state をその場で書き換える」と
     * 「新しい id を追加し、消えた id を削除する」を同時にやる。素で走らせると:
     *
     * 1. `syncMarkerState` の代入1つごとに state の subject が発火 → `updateHandler` が
     *    1件ずつ呼ばれる（1000件なら最大1000回）
     * 2. そのあと `applyDiff` の membership 通知が1回
     *
     * つまり **membership より先に in-place 更新が飛ぶ**。まだコレクションに入っていない
     * マーカーの更新を受け取ることになり、マーカークラスタリングのように「membership を
     * 見てから作り直す」consumer が壊れる。
     *
     * batchChanges の間は:
     * - in-place 変更は `updateHandler` を呼ばず `batchDirty` を立てるだけ（サンプリング窓
     *   にも積まない）
     * - `notify()` も同じく `batchDirty` を立てるだけ
     * - 抜けるときに dirty なら `notify()` を **1回だけ**
     *
     * 結果、N件の in-place 更新 + membership 変化が購読者への通知1回に畳まれる。捨てられた
     * in-place 更新は失われない: 購読者は通知を受けて `values()` から最新の state を読み直す。
     */
    batchChanges(action: () => void): void;
    replaceAll(states: S[]): void;
    clear(): void;
    /**
     * Mirrors Android's OverlayCollector.setUpdateHandler.
     * When set, subscribes to each state's asObservable() and calls handler
     * only when the fingerprint actually changes (distinctUntilChanged) — never
     * for the value the subscription replays on registration. Membership
     * changes are delivered to subscribe() listeners, not to this handler.
     */
    setUpdateHandler(handler: ((state: S) => void) | null): void;
    values(): S[];
    get(id: string): S | undefined;
    subscribe(fn: (map: ReadonlyMap<string, S>) => void): () => void;
    private startUpdateSub;
    /**
     * 変更を 5ms 窓にためて、窓の終わりに id ごと最新の1件だけ配る。
     *
     * debounce ではなく **sample**（最初の変更で窓を開き、以降は窓を延長しない）なのが
     * 重要で、android-sdk が `sample(updateDebounce)` を使うのと同じ理由。ドラッグは
     * 同じ state を毎フレーム書き換えるので、debounce だと指が止まるまで窓が延び続けて
     * 1回も配信されない。sample なら変更が続いている間も1窓に1回は届く。
     *
     * 以前はここが素通しで、`position` を1回書き換えるたびにプロバイダの
     * `update(state)`（＝ネイティブ SDK の再描画）が走っていた。
     */
    private scheduleUpdate;
    private cancelPendingUpdates;
    private stopUpdateSub;
    private notify;
    private notifyDebounced;
    private cancelFlushTimer;
    private notifySubscribers;
}

/**
 * Bridge between the React-side CircleState collector and a CircleCapable map controller.
 * Mirrors `CircleOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the circle collection changes, the controller's `compositionCircles()` is called.
 */
declare class CircleOverlay implements MapOverlayInterface<CircleState> {
    private readonly collector;
    constructor(collector: OverlayCollector<CircleState>);
    subscribe(fn: (data: ReadonlyMap<string, CircleState>) => void): () => void;
    render(data: ReadonlyMap<string, CircleState>, controller: MapViewControllerInterface): Promise<void>;
}

declare abstract class AbstractMarkerOverlayRenderer<MapViewHolderType extends MapViewHolder<unknown, unknown>, ActualMarker> implements MarkerOverlayRenderer<ActualMarker> {
    abstract onAdd(data: AddParams[]): Promise<(ActualMarker | null)[]>;
    abstract onChange(data: ChangeParams<ActualMarker>[]): Promise<(ActualMarker | null)[]>;
    abstract onRemove(data: MarkerEntity<ActualMarker>[]): Promise<void>;
    abstract onPostProcess(): Promise<void>;
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;
    animationOverlayHost: MarkerAnimationOverlayHost | null;
    /**
     * Set to `true` by a subclass constructor when the provider can hide its
     * native marker (see `setMarkerVisible`) so animation can be delegated to
     * a screen-space overlay instead of interpolating geo coordinates.
     * Mirrors Android's `AbstractMarkerOverlayRenderer.supportsAnimationOverlay`.
     */
    protected supportsAnimationOverlay: boolean;
    readonly holder: MapViewHolderType;
    readonly dropAnimateDuration: number;
    readonly bounceAnimateDuration: number;
    constructor({ holder, dropAnimateDuration, bounceAnimateDuration, }: {
        holder: MapViewHolderType;
        dropAnimateDuration?: number;
        bounceAnimateDuration?: number;
    });
    abstract setMarkerPosition(markerEntity: MarkerEntity<ActualMarker>, position: GeoPoint): void;
    /** Toggle native marker visibility. Overridden by providers that support the animation overlay. */
    setMarkerVisible(_markerEntity: MarkerEntity<ActualMarker>, _visible: boolean): void;
    onAnimate(entity: MarkerEntity<ActualMarker>): Promise<void>;
    /**
     * Instead of interpolating geographic coordinates (which produces wrong
     * directions when the map is tilted, rotated, or rendered as a globe/3D
     * scene), hand the animation to a screen-space overlay: hide the native
     * marker, let the host animate a bitmap of its icon in screen space
     * above the map (re-projecting every frame), then restore the marker.
     * Mirrors Android's `AbstractMarkerOverlayRenderer.animateOnOverlay`.
     */
    private animateOnOverlay;
    zoomToMetersPerPixel(zoom: number, tileSize: number): number;
    animateMarkerDrop(entity: MarkerEntity<ActualMarker>, duration: number): Promise<void>;
    animateMarkerBounce(entity: MarkerEntity<ActualMarker>, duration: number): Promise<void>;
    private animateFromScreenTop;
    private fromScreenOffset;
}

type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
interface ImageIconOptions {
    iconSize?: number;
    scale?: number;
    anchor?: Offset;
    infoAnchor?: Offset;
    debug?: boolean;
}
/**
 * 任意の画像ソース（HTMLImageElement / HTMLCanvasElement / ImageBitmap）を
 * マーカーアイコンとして使用するクラス。
 *
 * Android SDK の ImageIcon に対応する実装。
 */
declare class ImageIcon extends AbstractMarkerIcon {
    readonly image: ImageSource;
    readonly iconSize: number;
    readonly scale: number;
    readonly anchor: Offset;
    readonly infoAnchor: Offset;
    readonly debug: boolean;
    constructor(image: ImageSource, options?: ImageIconOptions);
    private getImageIdentity;
    equals(other: unknown): boolean;
    hashCode(): number;
    toBitmapIcon(): BitmapIcon;
}

declare enum Direction6 {
    Right = "Right",
    RightUp = "RightUp",
    LeftUp = "LeftUp",
    Left = "Left",
    LeftDown = "LeftDown",
    RightDown = "RightDown"
}
declare const Direction6Delta: Record<Direction6, {
    deltaQ: number;
    deltaR: number;
}>;

declare const Earth: Readonly<{
    /** WGS84 semi-major axis (equatorial radius) in meters. */
    RADIUS_METERS: 6378137;
    /** Equatorial circumference (2πa) in meters. */
    CIRCUMFERENCE_METERS: number;
    /** WGS84 flattening f = 1 / 298.257223563. */
    FLATTENING: number;
    /** WGS84 semi-minor axis (polar radius) b = a(1 - f) in meters. */
    SEMI_MINOR_AXIS_METERS: number;
    /** WGS84 first eccentricity squared e² = f(2 - f). */
    ECCENTRICITY_SQUARED: number;
}>;

interface Projection {
    project(position: GeoPointInterface): Offset;
    unproject(point: Offset): GeoPoint;
}

/**
 * Maximum extent of the Web Mercator projection: half the equatorial
 * circumference (πa ≈ 20037508.34 m). Projected x/y values fall within
 * ±this value.
 */
declare const WEB_MERCATOR_MAX_EXTENT_METERS: number;
declare class WebMercatorClass implements Projection {
    project(position: GeoPointInterface): Offset;
    unproject(point: Offset): GeoPoint;
}
declare const WebMercator: WebMercatorClass;

declare class WGS84class implements Projection {
    project(position: GeoPointInterface): Offset;
    unproject(point: Offset): GeoPoint;
}
declare const WGS84: WGS84class;

interface IdentifiedHexCell {
    id: string;
    cell: HexCell;
}
declare function createIdentifiedHexCell(id: string, cell: HexCell): IdentifiedHexCell;

interface HexGeocell {
    projection: Projection;
    baseHexSideLength: number;
    latLngToHexCoord(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCoord;
    latLngToHexCell(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCell;
    hexToLatLngCenter(params: {
        coord: HexCoord;
        latitude?: number;
        latHint?: number;
        zoom: number;
    }): GeoPoint;
    hexToCellId(params: {
        coord: HexCoord;
        zoom: number;
    }): string;
    hexToPolygonLatLng(params: {
        coord: HexCoord;
        latHint: number;
        zoom: number;
    }): GeoPoint[];
    enclosingCellOf(params: {
        points: MarkerState[];
        zoom: number;
    }): HexCell;
    hexCellsForPointsWithId(params: {
        points: MarkerState[];
        zoom: number;
    }): Set<IdentifiedHexCell>;
    hexDistance(params: {
        origin: HexCoord;
        dst: HexCoord;
    }): number;
    hexRange(params: {
        center: HexCoord;
        radius: number;
    }): HexCoord[];
}
declare class HexGeocellImpl implements HexGeocell {
    readonly projection: Projection;
    /** ズーム0における六角形の「辺の長さ」（m）。半径ではありません。 */
    readonly baseHexSideLength: number;
    constructor(params: {
        projection: Projection;
        baseHexSideLength?: number;
    });
    /** 緯度経度 -> 六角グリッド座標 */
    latLngToHexCoord(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCoord;
    /** 緯度経度 -> HexCell（ID/中心座標など含む） */
    latLngToHexCell(params: {
        position: GeoPoint;
        zoom: number;
    }): HexCell;
    /** 六角グリッド座標 -> 中心の緯度経度 */
    hexToLatLngCenter(params: {
        coord: HexCoord;
        latitude?: number;
        latHint?: number;
        zoom: number;
    }): GeoPoint;
    /** ズームを含むユニークなセルID */
    hexToCellId(params: {
        coord: HexCoord;
        zoom: number;
    }): string;
    /** 六角形ポリゴン（6頂点）を緯度経度で返す（フラットトップ） */
    hexToPolygonLatLng(params: {
        coord: HexCoord;
        latHint: number;
        zoom: number;
    }): GeoPoint[];
    /** 複数点の重心を囲むセル */
    enclosingCellOf(params: {
        points: MarkerState[];
        zoom: number;
    }): HexCell;
    /** 複数点それぞれに対応する HexCell と元IDのセット */
    hexCellsForPointsWithId(params: {
        points: MarkerState[];
        zoom: number;
    }): Set<IdentifiedHexCell>;
    /** 六角座標距離 */
    hexDistance(params: {
        origin: HexCoord;
        dst: HexCoord;
    }): number;
    /** 半径 r の六角範囲（axial） */
    hexRange(params: {
        center: HexCoord;
        radius: number;
    }): HexCoord[];
    /** 緯度・ズームに応じて辺長を補正（ズームは 2^-zoom、緯度スケールは cos(lat) で補正） */
    private adjustedHexSideLength;
    /** 六角中心の XY を返す（フラットトップ） */
    private hexCenterXY;
    /** XY -> 六角座標（axial） */
    private pixelToHex;
    /** 連続値のaxial座標(q,r)を最も近い格子点へ丸める */
    private cubeRound;
    /** 地球曲率を考慮した重心（球面近似） */
    private computeGeographicCentroid;
    static defaultGeocell(): HexGeocell;
}

declare class HexCellRegistry<ActualMarker> {
    private kdTree;
    private readonly allCells;
    private readonly entryIDsByCell;
    private readonly allEntries;
    private needsRebuild;
    private readonly lock;
    private readonly geocell;
    private readonly zoom;
    constructor(params: {
        geocell: HexGeocell;
        zoom: number;
    });
    /** 対象エンティティが属する HexCell を（登録せず）計算して返す */
    getCell(entity: MarkerEntity<ActualMarker>): HexCell;
    /** 登録/更新して属する HexCell を返す */
    setPoint(entity: MarkerEntity<ActualMarker>): HexCell;
    /** HexCell が存在するか */
    contains(hexId: string): boolean;
    /** エンティティをレジストリから削除 */
    removePoint(entity: MarkerEntity<ActualMarker>): boolean;
    /** 特定セルからエンティティを外す */
    private removeFromCell;
    /** 全消去 */
    clear(): void;
    private markDirty;
    /** インデックス再構築（必要時のみ） */
    private rebuildIfNeeded;
    /** 最も近い HexCell を返す */
    findNearest(point: GeoPoint): HexCell | null;
    /** 最も近い HexCell と距離 */
    findNearestWithDistance(point: GeoPoint): HexCellWithDistance | null;
    /** k 近傍（距離付き） */
    findNearestKWithDistance(params: {
        point: GeoPoint;
        k: number;
    }): HexCellWithDistance[];
    /** 半径内（メートル等）にある HexCell（距離付き） */
    findWithinRadiusWithDistance(params: {
        position: GeoPoint;
        radius: number;
    }): HexCellWithDistance[];
    /** 全 HexCell */
    all(): HexCell[];
    /** 指定 HexCell に属するエンティティID一覧（コピーを返す） */
    getEntryIDsByHexCell(hexCell: HexCell): Set<string> | null;
    /**
     * 指定位置／ズームでのピクセル数に相当する距離（m）
     * ※投影がメートルを返す前提
     */
    metersPerPixel(params: {
        position: GeoPoint;
        zoom: number;
        pixels: number;
        tileSize?: number;
    }): number;
    /** ピクセル半径内の HexCell（距離付き） */
    findWithinPixelRadius(params: {
        position: GeoPoint;
        zoom: number;
        pixels: number;
        tileSize?: number;
    }): HexCellWithDistance[];
    /** ID プレフィックス一致で検索（共通プレフィックス最適化想定） */
    findByIdPrefix(prefix: string): HexCell[];
    /** レジストリ状態の統計 */
    getStats(): RegistryStats;
}
interface RegistryStats {
    totalCells: number;
    totalEntries: number;
    kdTreeBuilt: boolean;
    needsRebuild: boolean;
}

interface HexCellWithDistance {
    cell: HexCell;
    distanceMeters: number;
}
declare function createHexCellWithDistance(params: {
    cell: HexCell;
    distanceMeters: number;
}): HexCellWithDistance;

interface KDTreeStats {
    nodeCount: number;
    maxDepth: number;
    isEmpty: boolean;
}
declare class KDTree {
    private readonly root;
    constructor(points: HexCell[]);
    /** 再帰的にK-D木を構築 */
    private build;
    /** 最近傍セルを返す（見つからない場合 null） */
    nearest(query: Offset): HexCell | null;
    /** 最近傍 + 距離 */
    nearestWithDistance(query: Offset): HexCellWithDistance | null;
    /** k 近傍 + 距離（距離昇順） */
    nearestKWithDistance(params: {
        query: Offset;
        k: number;
    }): HexCellWithDistance[];
    /** 半径内（メートルなど任意単位）にあるセルを距離付きで返す（距離昇順） */
    withinRadiusWithDistance(params: {
        query: Offset;
        radius: number;
    }): HexCellWithDistance[];
    /** 構造統計 */
    getStats(): KDTreeStats;
    private _nearest;
    private _squaredDistance;
    private _distance;
    private _countNodes;
    private _maxDepth;
}

/**
 * Memory usage statistics for MarkerManager optimization
 */
interface MarkerManagerStats {
    entityCount: number;
    hasSpatialIndex: boolean;
    spatialIndexInitialized: boolean;
    estimatedMemoryKB: number;
}
declare class MarkerManager<ActualMarker> {
    readonly minMarkerCount: number;
    protected readonly geocell: HexGeocell;
    private readonly entities;
    private cellRegistry;
    private isDestroyed;
    constructor(geocell: HexGeocell, minMarkerCount?: number);
    lock(): void;
    unlock(): void;
    getEntity(id: string): MarkerEntity<ActualMarker> | null;
    hasEntity(id: string): boolean;
    removeEntity(id: string): MarkerEntity<ActualMarker> | null;
    metersPerPixel({ position, zoom, pixels, tileSize, }: {
        position: GeoPoint;
        zoom: number;
        pixels: number;
        tileSize?: number;
    }): number;
    findNearest(position: GeoPoint): MarkerEntity<ActualMarker> | null;
    private bruteForceNearest;
    findByIdPrefix(prefix: string): HexCell[];
    registerEntity(entity: MarkerEntity<ActualMarker>): void;
    /** 空間操作が必要になった時だけ遅延初期化 */
    private ensureCellRegistry;
    updateEntity(entity: MarkerEntity<ActualMarker>): void;
    allEntities(): Array<MarkerEntity<ActualMarker>>;
    /** メモリ統計（概算） */
    getMemoryStats(): MarkerManagerStats;
    private estimateMemoryUsage;
    clear(): void;
    findMarkersInBounds(bounds: GeoRectBounds): Array<MarkerEntity<ActualMarker>>;
    /** マッププロバイダ切替時などに正しく破棄する */
    destroy(): void;
    static defaultManager<ActualMarker>(geocell?: HexGeocell | null, minMarkerCount?: number): MarkerManager<ActualMarker>;
}

/**
 * Strategy interface for handling marker rendering during camera changes.
 * Different map providers may have different optimal strategies for marker management.
 */
interface MarkerRenderingStrategy<ActualMarker> {
    markerManager: MarkerManager<ActualMarker>;
    clear(): void;
    onAdd(params: {
        data: MarkerState[];
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>;
    onUpdate(params: {
        state: MarkerState;
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>;
    /**
     * Handle camera position changes and update marker rendering accordingly.
     *
     * @param cameraPosition The new camera position
     * @param renderer The marker overlay renderer
     */
    onCameraChanged(cameraPosition: MapCameraPosition, renderer: MarkerOverlayRenderer<ActualMarker>): Promise<void>;
}

declare abstract class AbstractMarkerRenderingStrategy<ActualMarker> implements MarkerRenderingStrategy<ActualMarker> {
    /**
     * MarkerManager instance provided by dependency injection.
     * Each strategy can provide its own optimized MarkerManager implementation.
     */
    readonly markerManager: MarkerManager<ActualMarker>;
    protected readonly defaultMarkerIcon: BitmapIcon;
    constructor(
    /**
     * MarkerManager instance provided by dependency injection.
     * Each strategy can provide its own optimized MarkerManager implementation.
     */
    markerManager: MarkerManager<ActualMarker>);
    abstract onCameraChanged(cameraPosition: MapCameraPosition, renderer: MarkerOverlayRenderer<ActualMarker>): Promise<void>;
    clear(): void;
    onAdd(_params: {
        data: MarkerState[];
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>;
    onUpdate(_params: {
        state: MarkerState;
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>;
}

/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */
/**
 * 既定マーカーアイコンの見た目を決めるオプションと、その既定値。
 *
 * `BaseIconProperties` は「ピンの形と共通の装飾」を表し、塗り方（単色か画像か）だけが
 * サブクラスで変わる。オプションから内部表現へ落とすのが `createBaseProperties`。
 */
interface DefaultMarkerIconOptions {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    scale?: number;
    label?: string | null;
    labelTextColor?: string | null;
    labelTextSize?: number;
    labelTypeFace?: string;
    labelStrokeColor?: string;
    infoAnchor?: Offset;
    iconSize?: number;
    debug?: boolean;
}
/** ImageDefaultIcon のコンストラクタ引数。backgroundImage は必須。 */
interface ImageDefaultIconOptions extends DefaultMarkerIconOptions {
    backgroundImage: string | HTMLImageElement;
}
interface BaseIconProperties {
    strokeColor: string;
    strokeWidth: number;
    scale: number;
    label: string | null;
    labelTextColor: string | null;
    labelTextSize: number;
    labelTypeFace: string;
    labelStrokeColor: string;
    infoAnchor: Offset;
    iconSize: number;
    debug: boolean;
}

/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */

interface IconLayout {
    /** マーカー本体の一辺（= iconSize * scale、Android の canvasSize）。 */
    markerSize: number;
    /** ビットマップ幅（ラベルが広い場合はマーカーより横に広がる）。 */
    bitmapWidth: number;
    /** ビットマップ高さ（= markerSize）。 */
    bitmapHeight: number;
    /** マーカーを中央寄せするための水平オフセット。 */
    markerOffsetX: number;
    /** ラベルのアウトライン幅（Android: max(1*scale, 2)）。 */
    outlineStroke: number;
}

/**
 * 既定マーカーアイコンの土台。ピン形の輪郭・ラベル・寸法の計算を受け持ち、
 * 中身の塗り方だけをサブクラスに任せる。
 */
declare abstract class AbstractDefaultIcon extends AbstractMarkerIcon {
    protected readonly baseProperties: BaseIconProperties;
    readonly anchor: Offset;
    protected constructor(baseProperties: BaseIconProperties);
    get strokeColor(): string;
    get strokeWidth(): number;
    get scale(): number;
    get label(): string | null;
    get labelTextColor(): string | null;
    get labelTextSize(): number;
    get labelTypeFace(): string;
    get labelStrokeColor(): string;
    get iconSize(): number;
    get infoAnchor(): Offset;
    get debug(): boolean;
    toBitmapIcon(): BitmapIcon;
    hashCode(): number;
    /**
     * Android AbstractDefaultIcon.toBitmapIcon() / iOS makeIcon() と同じレイアウト計算。
     * すべてピクセル空間で行い、ラベルが広い場合はビットマップを横に広げてマーカーを
     * 中央寄せする（正方形固定にしない）。ラベルの文字サイズはマーカー scale に追従せず
     * 絶対値（Android/iOS と同じ）。
     */
    protected computeLayout(): IconLayout;
    protected createSvg(layout: IconLayout): string;
    /**
     * ラベル描画。Android drawLabel() と同じく円形部分の中心（markerSize * 0.35）へ
     * 通常ウェイト・絶対サイズで配置し、アウトライン（stroke）を下に敷いてから塗りを重ねる。
     */
    protected createLabelSvg(layout: IconLayout): string;
    protected abstract createFillSvg(markerPath: string, markerSize: number, markerOffsetX: number): string;
    protected abstract getUniqueProperties(): unknown;
}

/**
 * 単色で塗る既定アイコン。`DefaultMarkerIcon` はこれの別名。
 */
declare class ColorDefaultIcon extends AbstractDefaultIcon {
    readonly fillColor: string;
    constructor(options?: DefaultMarkerIconOptions);
    copy(options?: DefaultMarkerIconOptions): ColorDefaultIcon;
    protected createFillSvg(markerPath: string): string;
    protected getUniqueProperties(): unknown;
}
/**
 * ピンの中に画像を敷く既定アイコン。
 */
declare class ImageDefaultIcon extends AbstractDefaultIcon {
    readonly backgroundImage: string | HTMLImageElement;
    constructor(options: ImageDefaultIconOptions);
    copy(options?: Partial<ImageDefaultIconOptions>): ImageDefaultIcon;
    /**
     * ロード済みの HTMLImageElement が渡された場合は Canvas で描画して PNG data URL を返す。
     * SVG data URL は「SVG as image」サンドボックスにより内部の <image href="..."> が
     * ブロックされるため、外部 URL を参照する場合は必ず Canvas パスを使用する。
     */
    toBitmapIcon(): BitmapIcon;
    private toCanvasBitmapIcon;
    protected createFillSvg(markerPath: string, markerSize: number, markerOffsetX: number): string;
    protected getUniqueProperties(): unknown;
    private imageSourceUrl;
}
type DefaultMarkerIcon = ColorDefaultIcon;
declare const DefaultMarkerIcon: typeof ColorDefaultIcon;
declare const createDefaultIcon: () => DefaultMarkerIcon;
declare const hashDefaultMarkerIcon: (icon: DefaultMarkerIcon) => number;

interface MarkerCapable {
    compositionMarkers(data: MarkerState[]): Promise<void>;
    updateMarker(state: MarkerState): Promise<void>;
    setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDrag(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void;
    setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void;
    /** Route marker animations (Drop/Bounce) to a screen-space overlay instead of geo-interpolation. */
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    hasMarker(state: MarkerState): boolean;
}

/** 1回の renderer 呼び出しで扱うマーカー数。android-sdk の MARKER_RENDER_BATCH_SIZE と同値。 */
declare const MARKER_RENDER_BATCH_SIZE = 500;
interface MarkerIngestionResult<ActualMarker> {
    /** タイル描画対象の集合が変化したか（タイルの再生成が要る）。 */
    tiledDataChanged: boolean;
    /** 現在タイル描画中のマーカーが1件以上あるか。 */
    hasTiledMarkers: boolean;
    /**
     * アニメーションを開始すべきエンティティ。
     *
     * android-sdk の engine は内部で `renderer.onAnimate` を直接呼ぶが、こちらは呼ばずに返す。
     * React 実装はロックの外で `Promise.all` して同時再生させる必要があるため
     * （スクリーン空間オーバーレイの `onAnimate` はアニメーション終了時に解決するので、
     * ロック内で await すると他のマーカー操作をブロックし、アニメーション同士も直列化する）。
     */
    entitiesToAnimate: MarkerEntity<ActualMarker>[];
}
/**
 * マーカー取り込みの共有ロジック。
 *
 * 受け取った `MarkerState` の一覧を `MarkerManager` の現在状態と差分比較し、
 * `MarkerOverlayRenderer` を駆動して `MarkerManager` を更新する。
 *
 * プロバイダ固有のコントローラが差し込めるのは:
 * - 「タイル描画にするか、プロバイダのネイティブマーカーにするか」の判定（`shouldTile`）
 * - タイル済み ID の保持先（`tiledMarkerIds`）
 *
 * タイルオーバーレイそのもの（RasterLayer の state、キャッシュバスティング等）は
 * 引き続きコントローラ側の責務。
 *
 * android-sdk の `MarkerIngestionEngine.ingest` の移植。差分は上記 `entitiesToAnimate` と、
 * android-sdk が engine の外に置いているバッチ分割をこちらは engine 内に持つ点
 * （React 側は `AbstractMarkerController` に非タイル経路が別に無いため）。
 */
declare function ingestMarkers<ActualMarker>(params: {
    data: MarkerState[];
    markerManager: MarkerManager<ActualMarker>;
    renderer: MarkerOverlayRenderer<ActualMarker>;
    defaultMarkerIcon: BitmapIcon;
    tilingEnabled: boolean;
    tiledMarkerIds: Set<string>;
    shouldTile: (state: MarkerState) => boolean;
    onMarkerAdded?: (entity: MarkerEntity<ActualMarker>) => void;
}): Promise<MarkerIngestionResult<ActualMarker>>;

/**
 * Bridge between the React-side MarkerState collector and a MarkerCapable map controller.
 * Mirrors `MarkerOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the marker collection changes, the controller's `compositionMarkers()` is called.
 */
declare class MarkerOverlay implements MapOverlayInterface<MarkerState> {
    private readonly collector;
    constructor(collector: OverlayCollector<MarkerState>);
    subscribe(fn: (data: ReadonlyMap<string, MarkerState>) => void): () => void;
    render(data: ReadonlyMap<string, MarkerState>, controller: MapViewControllerInterface): Promise<void>;
}

/**
 * Marker renderer backed by a map's marker collector.
 *
 * `MarkerRenderingStrategy` implementations (marker clustering など) only ever talk
 * to `MarkerOverlayRenderer` — the same contract `MarkerClusterStrategy.kt` uses on
 * Android — and the platform decides how the resulting markers reach the map.
 * Web では各 `react-for-*` がこのレンダラを `MarkerRenderingSupport.createMarkerRenderer`
 * から返す。コレクタから先はプロバイダ通常のマーカー経路がそのまま処理するので、
 * プロバイダごとの実装差は要らない（android-sdk / ios-sdk はネイティブのマーカー型が
 * プロバイダごとに違うため、そこで初めて実装が分かれる）。
 *
 * Add / change / remove are staged and committed as a single `applyDiff()` in
 * `onPostProcess()` — the same commit point Android uses. Notifying per marker
 * instead would re-run the provider's entire marker composition once per marker,
 * which reconstructs the tile renderer thousands of times on large datasets.
 *
 * `ActualMarker` is `MarkerState`: the collector is the "native" marker layer
 * here, so a rendered marker is identified by the state that was written to it.
 */
declare class CollectorMarkerOverlayRenderer implements MarkerOverlayRenderer<MarkerState> {
    private readonly collector;
    readonly holder: MapViewHolder<unknown, unknown> | undefined;
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;
    animationOverlayHost: MarkerAnimationOverlayHost | null;
    private readonly pendingUpserts;
    private readonly pendingRemoveIds;
    /** Ids currently written to the collector, so unmount can take them all back. */
    private readonly renderedIds;
    constructor(collector: OverlayCollector<MarkerState>, holder: MapViewHolder<unknown, unknown> | undefined);
    onAdd(data: AddParams[]): Promise<(MarkerState | null)[]>;
    onChange(data: ChangeParams<MarkerState>[]): Promise<(MarkerState | null)[]>;
    onRemove(data: MarkerEntity<MarkerState>[]): Promise<void>;
    /**
     * Animation is driven by the strategy (it interpolates positions and calls
     * `onChange()` per frame), exactly as on Android — there is nothing for the
     * renderer to play back on its own.
     */
    onAnimate(_entity: MarkerEntity<MarkerState>): Promise<void>;
    onPostProcess(): Promise<void>;
    setMarkerVisible(_entity: MarkerEntity<MarkerState>, _visible: boolean): void;
    /** Drops every marker this renderer wrote. Used when the group unmounts. */
    reset(): void;
    private stage;
}

/**
 * Strategy-driven marker controller.
 *
 * Mirrors `StrategyMarkerController.kt` (android-sdk-core) /
 * `StrategyMarkerController.swift` (ios-sdk-core): camera bounds are remembered
 * via `lastKnownBounds` so add/update keep working between camera events, states
 * received before the first camera fix are queued in `pendingStates`, and
 * `find()` hit-tests the tapped point against the nearest marker's icon bounds
 * with `Settings.Default.tapTolerance`.
 */
declare class StrategyMarkerController<ActualMarker> implements OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState> {
    readonly markerManager: MarkerManager<ActualMarker>;
    readonly zIndex: number;
    private mapCameraPosition;
    private lastKnownBounds;
    private readonly semaphore;
    private pendingStates;
    dragStartListener: OnMarkerEventHandler | null;
    dragListener: OnMarkerEventHandler | null;
    dragEndListener: OnMarkerEventHandler | null;
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;
    private readonly strategy;
    private readonly renderer;
    clickListener: OnMarkerEventHandler | null;
    constructor({ strategy, renderer, clickListener, }: {
        strategy: MarkerRenderingStrategy<ActualMarker>;
        renderer: MarkerOverlayRenderer<ActualMarker>;
        clickListener?: OnMarkerEventHandler | null;
    });
    dispatchClick(state: MarkerState): void;
    dispatchDragStart(state: MarkerState): void;
    dispatchDrag(state: MarkerState): void;
    dispatchDragEnd(state: MarkerState): void;
    dispatchAnimateStart(state: MarkerState): void;
    dispatchAnimateEnd(state: MarkerState): void;
    add(data: MarkerState[]): Promise<void>;
    update(state: MarkerState): Promise<void>;
    clear(): Promise<void>;
    getEntity(id: string): MarkerEntity<ActualMarker> | null;
    find(position: GeoPoint): MarkerEntity<ActualMarker> | null;
    /** `undefined` means the holder projects asynchronously (no sync value available). */
    private resolveSyncOffset;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void>;
    destroy(): void;
}

interface MarkerEventController<ActualMarker> {
    readonly controller?: StrategyMarkerController<ActualMarker>;
    readonly renderer?: MarkerOverlayRenderer<ActualMarker>;
}
/**
 * マーカー描画プラグイン（marker-clustering など）が、マップコントローラ自身に
 * プラグインのインタフェースを実装させずにレンダラ／コントローラを作るための
 * map スコープの capability。
 *
 * android-sdk の `MarkerRenderingSupport.kt` / ios-sdk の `MarkerRenderingSupport.swift`
 * と同じ契約。プロバイダが {@link MarkerRenderingSupportKey} で
 * {@link MutableMapServiceRegistry} に登録し、プラグインがそれを解決する。
 */
interface MarkerRenderingSupport<ActualMarker> {
    createMarkerRenderer(strategy: MarkerRenderingStrategy<ActualMarker>): MarkerOverlayRenderer<ActualMarker>;
    createMarkerEventController(controller: StrategyMarkerController<ActualMarker>, renderer: MarkerOverlayRenderer<ActualMarker>): MarkerEventController<ActualMarker>;
    registerMarkerEventController(controller: MarkerEventController<ActualMarker>): void;
    mapLoadedState?: {
        value: boolean;
    } | null;
    onMarkerRenderingReady?(): void;
}
/**
 * 型引数を消した {@link MarkerRenderingSupport}。レジストリのキーは 1 つなので、
 * `ActualMarker` の異なる実装を同じキーで出し入れするためにこの別名を使う。
 * ios-sdk の `AnyMarkerRenderingSupport` と同じ役割。
 */
type AnyMarkerRenderingSupport = MarkerRenderingSupport<any>;
/**
 * {@link MarkerRenderingSupport} をレジストリから引くためのキー。
 * android-sdk の `object MarkerRenderingSupportKey : MapServiceKey<MarkerRenderingSupport<*>>`、
 * ios-sdk の `enum MarkerRenderingSupportKey: MapServiceKey` に対応する。
 */
declare const MarkerRenderingSupportKey: MapServiceKey<AnyMarkerRenderingSupport>;
/**
 * web の各 `react-for-*` が登録する既定の {@link MarkerRenderingSupport}。
 *
 * android-sdk / ios-sdk ではプロバイダごとにネイティブのマーカー型が違うため実装も
 * 分かれるが、web ではクラスタ結果が `MarkerState` のままマーカーコレクタへ入り、
 * そこから先はプロバイダ通常のマーカー経路が処理する。つまり全プロバイダで同じ実装で
 * 足りるので、重複を避けてここに 1 つだけ置く。別の描画経路が要るプロバイダは、
 * 自前の {@link MarkerRenderingSupport} を登録すればよい。
 */
declare function createCollectorMarkerRenderingSupport(params: {
    collector: OverlayCollector<MarkerState>;
    holder: MapViewHolder<unknown, unknown> | undefined;
    /** 地図の準備完了状態。クラスタリング開始の合図に使う。 */
    mapLoadedState?: {
        value: boolean;
    } | null;
    /** 描画準備が整った直後に呼ばれる。初期カメラをオーバーレイへ配る等に使う。 */
    onMarkerRenderingReady?: () => void;
}): MarkerRenderingSupport<MarkerState>;

/**
 * Options for marker tiling optimization.
 *
 * When enabled, large sets of static markers can be rendered as tile overlays
 * to avoid per-marker add/update cost in native map SDKs.
 * Mirrors `MarkerTilingOptions` from `MarkerTilingOptions.kt`.
 */
interface MarkerTilingOptions {
    readonly enabled: boolean;
    readonly debugTileOverlay: boolean;
    readonly minMarkerCount: number;
    readonly cacheSize: number;
    /**
     * Per-marker icon scale multiplier applied during tile rendering.
     * `(zoom: number, state: MarkerState) => number`
     */
    readonly iconScaleCallback: ((state: MarkerState, zoom: number) => number) | null;
}
declare namespace MarkerTilingOptions {
    const Default: MarkerTilingOptions;
    const Disabled: MarkerTilingOptions;
}

/**
 * Abstract base for marker rendering strategies that use viewport-based optimization.
 * Only markers within the current camera viewport are rendered; out-of-viewport
 * markers are tracked in the manager but not submitted to the renderer.
 * Mirrors `AbstractViewportStrategy` from `AbstractViewportStrategy.kt`.
 */
declare abstract class AbstractViewportStrategy<ActualMarker> extends AbstractMarkerRenderingStrategy<ActualMarker> {
    readonly markerManager: MarkerManager<ActualMarker>;
    constructor({ geocell, minMarkerCount, }: {
        geocell: HexGeocell;
        minMarkerCount?: number;
    });
    onAdd({ data, viewport, renderer, }: {
        data: MarkerState[];
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>;
    onUpdate({ state, viewport, renderer, }: {
        state: MarkerState;
        viewport: GeoRectBounds;
        renderer: MarkerOverlayRenderer<ActualMarker>;
    }): Promise<boolean>;
    clear(): void;
}

/** Uniform lat/lng grid used to cull the candidate set per tile without scanning every marker. */
declare class GeoGridIndex<T extends {
    position: GeoPoint;
}> {
    private readonly items;
    private readonly cells;
    private static readonly CELL_DEG;
    private static readonly MAX_CELLS_PER_QUERY;
    constructor(items: ReadonlyArray<T>);
    private cellKey;
    /** Items whose position falls within the given padded lat/lng bounds. */
    queryBounds(south: number, north: number, west: number, east: number): T[];
}

/** Decodes BitmapIcon.url (a self-contained data: URL) into a drawable image, with dedup + caching. */
declare class IconImageCache {
    private readonly ready;
    private readonly pending;
    private readonly failed;
    private static readonly MAX_READY_ENTRIES;
    private static readonly MAX_FAILED_ENTRIES;
    get(url: string): ImageBitmap | HTMLImageElement | undefined;
    /** Decode (or return the in-flight/cached decode of) an icon image. Never throws. */
    ensure(url: string): Promise<ImageBitmap | HTMLImageElement | null>;
    private evictReadyIfNeeded;
    private addFailed;
    private decode;
}

declare const MARKER_HIT_RADIUS_TOUCH_PX = 20;
declare const MARKER_HIT_RADIUS_MOUSE_PX = 6;
/** A marker resolved to its decoded image and tile-local draw geometry, ready for drawImage(). */
interface PreparedMarker {
    image: ImageBitmap | HTMLImageElement;
    centerNormX: number;
    centerNormY: number;
    drawW: number;
    drawH: number;
    anchorX: number;
    anchorY: number;
}

interface TileRequest {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

interface TileProvider {
    renderTile(request: TileRequest): Uint8Array | null | Promise<Uint8Array | null>;
}

/**
 * Canvas-based tile renderer for large marker datasets.
 *
 * Mirrors Android/iOS MarkerTileRenderer: renders each marker's actual icon
 * (not a placeholder) onto Canvas tiles served via LocalTileServer, enabling
 * tens of thousands of markers without creating individual DOM elements.
 * A lat/lng grid index keeps per-tile queries proportional to the markers
 * actually near that tile instead of scanning the whole dataset.
 *
 * Also provides `findNearest()` for hit-testing click/tap events against the same
 * marker set, with an adaptive radius for touch vs. mouse input.
 */
declare class MarkerTileRenderer<T extends {
    position: GeoPoint;
    icon?: MarkerIcon | null;
}> implements TileProvider {
    private readonly items;
    readonly tileSize: number;
    readonly extraIconScale: number;
    private readonly iconScale;
    private readonly debugTileOverlay;
    private readonly grid;
    private readonly icons;
    private readonly defaultBitmapIcon;
    /** Per-instance tile output cache; each sync creates a fresh renderer instance, so no invalidation is needed. */
    private readonly tileCache;
    constructor(items: ReadonlyArray<T>, tileSize?: number, iconScaleCallback?: (item: T, zoom: number) => number, extraIconScale?: number, debugTileOverlay?: boolean);
    private bitmapIconOf;
    /** Decode every unique icon up front. Call before relying on the synchronous renderTileDataUrl() path. */
    preloadIcons(): Promise<void>;
    private tileKey;
    private cacheTile;
    private queryCandidates;
    private prepareMarkers;
    /** Kick off (but don't await) decoding for any candidate not yet in the icon cache. */
    private warmIcons;
    private createCanvas;
    private draw;
    private drawDebugOverlay;
    private canvasToBytes;
    renderTile(req: TileRequest): Promise<Uint8Array | null>;
    /**
     * Synchronous best-effort render for APIs that require a data: URL
     * immediately (e.g. Google Maps ImageMapType.getTileUrl). Markers whose
     * icon hasn't finished decoding yet are skipped for this call and
     * decoded in the background — call `preloadIcons()` first to avoid this
     * gap on first paint.
     */
    renderTileDataUrl(req: TileRequest): string | null;
    /**
     * Serialize items + deduped icon bitmaps for transfer to the Service
     * Worker, so tiles can be rendered with OffscreenCanvas without a
     * main-thread round-trip. Icons are decoded (async) and deduplicated by
     * BitmapIcon.url so identical icons are only transferred once.
     *
     * `zoomScales` mirrors the original design: computed from a representative
     * item, since `iconScaleCallback` is usually zoom-only in practice. Items
     * whose icon could not be decoded to an ImageBitmap (SW contexts have no
     * <img>) fall back to the default icon's index rather than being dropped,
     * so they still render (as the default icon) instead of silently vanishing.
     */
    toSWData(): Promise<{
        items: {
            lat: number;
            lng: number;
            iconIndex: number;
        }[];
        icons: {
            bitmap: ImageBitmap;
            anchor: {
                x: number;
                y: number;
            };
            size: {
                width: number;
                height: number;
            };
        }[];
        zoomScales: number[];
        extraIconScale: number;
    }>;
    /**
     * Find the nearest item to `click` within `hitRadiusPx` pixels at the given zoom level.
     *
     * Use `MARKER_HIT_RADIUS_TOUCH_PX` for finger taps and `MARKER_HIT_RADIUS_MOUSE_PX`
     * for mouse/pen, or supply a custom radius. Returns `null` when nothing is close enough.
     */
    findNearest(click: GeoPoint, hitRadiusPx: number, zoom: number): T | null;
}

interface PolygonFingerPrint {
    id: number;
    strokeColor: number;
    strokeWidth: number;
    fillColor: number;
    geodesic: number;
    zIndex: number;
    points: number;
    holes: number;
    extra: number;
}
interface PolygonEvent {
    state: PolygonState;
    clicked: GeoPoint;
}
type OnPolygonEventHandler = (event: PolygonEvent) => void;
interface PolygonState {
    readonly id: string;
    points: GeoPoint[];
    holes: GeoPoint[][];
    strokeColor: string;
    strokeWidth: number;
    fillColor: string;
    geodesic: boolean;
    zIndex: number;
    extra: Serializable | null;
    onClick: OnPolygonEventHandler | null;
    fingerPrint(): PolygonFingerPrint;
    copy(opts?: PolygonStateCopyParams): PolygonState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): {
        subscribe: (fn: (fp: PolygonFingerPrint) => void) => () => void;
    };
}
interface PolygonStateCopyParams {
    points?: GeoPoint[];
    holes?: GeoPoint[][];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolygonEventHandler | null;
}
declare function createPolygonState(params: {
    points: GeoPoint[];
    holes?: GeoPoint[][];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolygonEventHandler | null;
}): PolygonState;

interface PolygonEntity<ActualPolygon> {
    readonly polygon: ActualPolygon;
    readonly state: PolygonState;
    readonly fingerPrint: PolygonFingerPrint;
}
declare const createPolygonEntity: <ActualPolygon>(params: {
    polygon: ActualPolygon;
    state: PolygonState;
}) => PolygonEntity<ActualPolygon>;

interface PolygonAddParams {
    readonly state: PolygonState;
}
interface PolygonChangeParams<ActualPolygon> {
    readonly current: PolygonEntity<ActualPolygon>;
    readonly prev: PolygonEntity<ActualPolygon>;
}
interface PolygonOverlayRenderer<ActualPolygon> {
    onAdd(data: PolygonAddParams[]): Promise<(ActualPolygon | null)[]>;
    onChange(data: PolygonChangeParams<ActualPolygon>[]): Promise<(ActualPolygon | null)[]>;
    onRemove(data: PolygonEntity<ActualPolygon>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

declare abstract class AbstractPolygonOverlayRenderer<MapViewHolderType extends MapViewHolder<unknown, unknown>, ActualPolygon> implements PolygonOverlayRenderer<ActualPolygon> {
    readonly holder: MapViewHolderType;
    constructor(holder: MapViewHolderType);
    abstract removePolygon(entity: PolygonEntity<ActualPolygon>): Promise<void>;
    abstract createPolygon(state: PolygonState): Promise<ActualPolygon | null>;
    abstract updatePolygonProperties(params: {
        polygon: ActualPolygon;
        current: PolygonEntity<ActualPolygon>;
        prev: PolygonEntity<ActualPolygon>;
    }): Promise<ActualPolygon | null>;
    /**
     * 描画に渡す直前に重なった穴を結合する。android-sdk の各 `PolygonOverlayRenderer` が持つ
     * `resolveHoles(state)` と同じ位置づけで、`Polygon.tsx` のコンポーネント段が再実行されない
     * 経路（頂点ドラッグ等での `state.holes` 差し替え）を補う。
     */
    protected resolveHoles(state: PolygonState): PolygonState;
    onAdd(data: PolygonAddParams[]): Promise<(ActualPolygon | null)[]>;
    onChange(data: PolygonChangeParams<ActualPolygon>[]): Promise<(ActualPolygon | null)[]>;
    onRemove(data: PolygonEntity<ActualPolygon>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

/**
 * Turns an outer ring plus any number of hole rings into a single ring whose
 * holes are stitched in with bridges (equivalent to mapbox/earcut's
 * `eliminateHoles`). android-sdk-core `HoleBridge.kt` and ios-sdk-core
 * `HoleBridge.swift` are the same algorithm.
 *
 * Use it with renderers that cannot express inner rings natively (TomTom's
 * plain Polygon, for instance) to fill a polygon-with-holes as one plain
 * polygon. Every hole is joined to the outer ring (or to a ring already
 * bridged) by a zero-width bridge, leaving one weakly simple polygon. The fill
 * cuts the holes out correctly, but the bridges remain as thin slits, so draw
 * the outline separately with stroke-only polygons.
 *
 * Input winding does not matter (normalized internally to CCW outer / CW
 * holes). Coordinates are treated as x = longitude, y = latitude.
 *
 * @param separation Degrees by which to offset the "outbound" and "inbound"
 *   edges of a bridge sideways. At 0 the bridge has zero width (the two edges
 *   have identical coordinates), which Android's TomTom fills as-is, but the
 *   tessellators in iOS TomTom (Orbis) and HERE treat as a self-touching ring
 *   and either break the fill or ignore the holes. A positive value yields a
 *   strictly simple ring whose holes still cut out under either fill rule (the
 *   gap is invisible on screen).
 */
declare function bridgeHolesIntoSingleRing(outer: GeoPoint[], holes: GeoPoint[][], separation?: number): GeoPoint[];
/**
 * Wrap-aware bridging.
 *
 * The standard (earcut-style) bridge searches westwards from a hole's leftmost
 * vertex, so on a world-mask-sized outer ring a bridge edge can span more than
 * 180° of longitude. Native map renderers (TomTom Orbis, HERE, …) draw such an
 * edge the "short way" (across the antimeridian), which self-intersects the
 * ring and breaks the fill. When the westward result contains an edge over
 * 180°, this mirrors the longitudes, bridges eastwards instead, and returns
 * whichever result keeps the longitude steps smaller.
 */
declare function bridgeHolesIntoSingleRingWrapAware(outer: GeoPoint[], holes: GeoPoint[][], separation?: number): GeoPoint[];

interface PolygonCapable {
    compositionPolygons(data: PolygonState[]): Promise<void>;
    updatePolygon(state: PolygonState): Promise<void>;
    /** @deprecated Use PolygonState.onClick instead. */
    setOnPolygonClickListener(listener: OnPolygonEventHandler | null): void;
    hasPolygon(state: PolygonState): boolean;
}

interface PolygonManagerInterface<ActualPolygon> {
    registerEntity(entity: PolygonEntity<ActualPolygon>): void;
    removeEntity(id: string): PolygonEntity<ActualPolygon> | null;
    getEntity(id: string): PolygonEntity<ActualPolygon> | null;
    hasEntity(id: string): boolean;
    allEntities(): PolygonEntity<ActualPolygon>[];
    clear(): void;
    find(position: GeoPoint): PolygonEntity<ActualPolygon> | null;
    updateEntity(entity: PolygonEntity<ActualPolygon>): void;
}
declare class PolygonManager<ActualPolygon> implements PolygonManagerInterface<ActualPolygon> {
    private readonly entities;
    registerEntity(entity: PolygonEntity<ActualPolygon>): void;
    updateEntity(entity: PolygonEntity<ActualPolygon>): void;
    removeEntity(id: string): PolygonEntity<ActualPolygon> | null;
    getEntity(id: string): PolygonEntity<ActualPolygon> | null;
    hasEntity(id: string): boolean;
    allEntities(): PolygonEntity<ActualPolygon>[];
    clear(): void;
    find(position: GeoPoint): PolygonEntity<ActualPolygon> | null;
    private pointInPolygonWindingNumber;
    private isLeft;
    private pointOnSegment;
    private unwrapLongitudesAround;
}

declare abstract class PolygonController<ActualPolygon> implements OverlayController<PolygonState, PolygonEntity<ActualPolygon>, PolygonEvent> {
    readonly zIndex: number;
    readonly polygonManager: PolygonManagerInterface<ActualPolygon>;
    readonly renderer: PolygonOverlayRenderer<ActualPolygon>;
    clickListener: OnPolygonEventHandler | null;
    private semaphore;
    constructor({ polygonManager, renderer, clickListener, }: {
        polygonManager: PolygonManagerInterface<ActualPolygon>;
        renderer: PolygonOverlayRenderer<ActualPolygon>;
        clickListener?: OnPolygonEventHandler | null;
    });
    dispatchClick(event: PolygonEvent): void;
    composition(data: PolygonState[]): Promise<void>;
    has(state: PolygonState): boolean;
    setOnClickListener(listener: OnPolygonEventHandler | null): void;
    add(data: PolygonState[]): Promise<void>;
    update(state: PolygonState): Promise<void>;
    clear(): Promise<void>;
    find(position: GeoPoint): PolygonEntity<ActualPolygon> | null;
    onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void>;
    destroy(): void;
}

/**
 * Bridge between the React-side PolygonState collector and a PolygonCapable map controller.
 * Mirrors `PolygonOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the polygon collection changes, the controller's `compositionPolygons()` is called.
 */
declare class PolygonOverlay implements MapOverlayInterface<PolygonState> {
    private readonly collector;
    constructor(collector: OverlayCollector<PolygonState>);
    subscribe(fn: (data: ReadonlyMap<string, PolygonState>) => void): () => void;
    render(data: ReadonlyMap<string, PolygonState>, controller: MapViewControllerInterface): Promise<void>;
}

/**
 * Unions overlapping hole rings in a planar lon/lat coordinate space, with no
 * external geometry library.
 *
 * android-sdk (`PolygonHoleUnion.kt`) and ios-sdk have the equivalent port of
 * this implementation — no platform uses an external geometry library. Instead
 * of a Boolean-op sweep line, this builds the planar arrangement of all hole
 * edges (splitting them at every intersection), keeps only the sub-edges that
 * lie on the outer boundary of the union — those with the union interior on
 * exactly one side, decided by point-in-polygon coverage — and chains them back
 * into rings.
 *
 * Notes:
 * - Planar geometry (not geodesic). For very large polygons or near the poles,
 *   results may differ from spherical expectations.
 * - Any failure falls back to returning the rings unchanged.
 */
declare function unionHoleRings(holes: GeoPoint[][]): GeoPoint[][];
/** Unions overlapping hole rings and returns a copied PolygonState when changed. */
declare function unionHoles(state: PolygonState): PolygonState;
/** Alias: in-place mutation variant. */
declare function unionHolesInPlace(state: PolygonState): PolygonState;
/**
 * 描画直前に穴のユニオンを保証する（レンダラ段）。
 *
 * android-sdk / ios-sdk は穴のユニオンを 2 段構えで適用している:
 *   1. コンポーネント層（`PolygonComponent.kt` / `MapViewContent.swift` の `Polygon`）が
 *      state 1 インスタンスにつき 1 回 `unionHolesInPlace()` を呼ぶ。
 *   2. 各プロバイダの `PolygonOverlayRenderer` がジオメトリ組み立て時に `resolveHoles()` を通す。
 *
 * 2 が要るのは、頂点ドラッグのように後から `state.holes` が差し替わる経路では 1 が
 * 再実行されないため（`Polygon.tsx` の union は `[state]` 依存で、holes 差し替えでは走らない）。
 *
 * `state` は変更せず、必要なときだけコピーを返す。PolygonManager が保持する state は
 * 未ユニオンのままにしておき、ヒットテストは元の穴リングで行う（android-sdk と同じ）。
 */
declare function resolveHoles(state: PolygonState): PolygonState;

interface PolylineFingerPrint {
    id: number;
    strokeColor: number;
    strokeWidth: number;
    geodesic: number;
    zIndex: number;
    points: number;
    extra: number;
}
interface PolylineEvent {
    state: PolylineState;
    clicked: GeoPoint;
}
type OnPolylineEventHandler = (event: PolylineEvent) => void;
interface PolylineState {
    readonly id: string;
    points: GeoPoint[];
    strokeColor: string;
    strokeWidth: number;
    geodesic: boolean;
    zIndex: number;
    extra: Serializable | null;
    onClick: OnPolylineEventHandler | null;
    fingerPrint(): PolylineFingerPrint;
    copy(opts?: PolylineStateCopyParams): PolylineState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): {
        subscribe: (fn: (fp: PolylineFingerPrint) => void) => () => void;
    };
}
interface PolylineStateCopyParams {
    points?: GeoPoint[];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolylineEventHandler | null;
}
declare function createPolylineState(params: {
    points: GeoPoint[];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolylineEventHandler | null;
}): PolylineState;

interface PolylineEntity<ActualPolyline> {
    readonly polyline: ActualPolyline;
    readonly state: PolylineState;
    readonly fingerPrint: PolylineFingerPrint;
    readonly bounds: GeoRectBounds;
}
declare function createPolylineEntity<ActualPolyline>(params: {
    polyline: ActualPolyline;
    state: PolylineState;
}): PolylineEntity<ActualPolyline>;

interface PolylineAddParams {
    readonly state: PolylineState;
}
interface PolylineChangeParams<ActualPolyline> {
    readonly current: PolylineEntity<ActualPolyline>;
    readonly prev: PolylineEntity<ActualPolyline>;
}
interface PolylineOverlayRenderer<ActualPolyline> {
    onAdd(data: PolylineAddParams[]): Promise<(ActualPolyline | null)[]>;
    onChange(data: PolylineChangeParams<ActualPolyline>[]): Promise<(ActualPolyline | null)[]>;
    onRemove(data: PolylineEntity<ActualPolyline>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

declare abstract class AbstractPolylineOverlayRenderer<MapViewHolderType extends MapViewHolder<unknown, unknown>, ActualPolyline> implements PolylineOverlayRenderer<ActualPolyline> {
    readonly holder: MapViewHolderType;
    constructor(holder: MapViewHolderType);
    abstract createPolyline(state: PolylineState): Promise<ActualPolyline | null>;
    abstract updatePolylineProperties(params: {
        polyline: ActualPolyline;
        current: PolylineEntity<ActualPolyline>;
        prev: PolylineEntity<ActualPolyline>;
    }): Promise<ActualPolyline | null>;
    abstract removePolyline(entity: PolylineEntity<ActualPolyline>): Promise<void>;
    onAdd(data: PolylineAddParams[]): Promise<(ActualPolyline | null)[]>;
    onChange(data: PolylineChangeParams<ActualPolyline>[]): Promise<(ActualPolyline | null)[]>;
    onRemove(data: PolylineEntity<ActualPolyline>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

interface PolylineCapable {
    compositionPolylines(data: PolylineState[]): Promise<void>;
    updatePolyline(state: PolylineState): Promise<void>;
    /** @deprecated Use PolylineState.onClick instead. */
    setOnPolylineClickListener(listener: OnPolylineEventHandler | null): void;
    hasPolyline(state: PolylineState): boolean;
}

interface PolylineHitResult<ActualPolyline> {
    readonly entity: PolylineEntity<ActualPolyline>;
    readonly closestPoint: GeoPoint;
}
interface PolylineManagerInterface<ActualPolyline> {
    registerEntity(entity: PolylineEntity<ActualPolyline>): void;
    removeEntity(id: string): PolylineEntity<ActualPolyline> | null;
    getEntity(id: string): PolylineEntity<ActualPolyline> | null;
    hasEntity(id: string): boolean;
    allEntities(): PolylineEntity<ActualPolyline>[];
    clear(): void;
    updateEntity(entity: PolylineEntity<ActualPolyline>): void;
    find(position: GeoPoint, cameraPosition?: MapCameraPosition | null): PolylineHitResult<ActualPolyline> | null;
}
declare class PolylineManager<ActualPolyline> implements PolylineManagerInterface<ActualPolyline> {
    private readonly entities;
    registerEntity(entity: PolylineEntity<ActualPolyline>): void;
    updateEntity(entity: PolylineEntity<ActualPolyline>): void;
    removeEntity(id: string): PolylineEntity<ActualPolyline> | null;
    getEntity(id: string): PolylineEntity<ActualPolyline> | null;
    hasEntity(id: string): boolean;
    allEntities(): PolylineEntity<ActualPolyline>[];
    clear(): void;
    find(position: GeoPoint, cameraPosition?: MapCameraPosition | null): PolylineHitResult<ActualPolyline> | null;
}

declare abstract class PolylineController<ActualPolyline> implements OverlayController<PolylineState, PolylineEntity<ActualPolyline>, PolylineEvent> {
    readonly zIndex: number;
    readonly polylineManager: PolylineManagerInterface<ActualPolyline>;
    readonly renderer: PolylineOverlayRenderer<ActualPolyline>;
    clickListener: OnPolylineEventHandler | null;
    private semaphore;
    private currentCameraPosition;
    constructor({ polylineManager, renderer, clickListener, }: {
        polylineManager: PolylineManagerInterface<ActualPolyline>;
        renderer: PolylineOverlayRenderer<ActualPolyline>;
        clickListener?: OnPolylineEventHandler | null;
    });
    dispatchClick(event: PolylineEvent): void;
    composition(data: PolylineState[]): Promise<void>;
    has(state: PolylineState): boolean;
    setOnClickListener(listener: OnPolylineEventHandler | null): void;
    add(data: PolylineState[]): Promise<void>;
    update(state: PolylineState): Promise<void>;
    clear(): Promise<void>;
    find(position: GeoPoint): PolylineEntity<ActualPolyline> | null;
    findWithClosestPoint(position: GeoPoint): PolylineHitResult<ActualPolyline> | null;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void>;
    destroy(): void;
}

/**
 * Bridge between the React-side PolylineState collector and a PolylineCapable map controller.
 * Mirrors `PolylineOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the polyline collection changes, the controller's `compositionPolylines()` is called.
 */
declare class PolylineOverlay implements MapOverlayInterface<PolylineState> {
    private readonly collector;
    constructor(collector: OverlayCollector<PolylineState>);
    subscribe(fn: (data: ReadonlyMap<string, PolylineState>) => void): () => void;
    render(data: ReadonlyMap<string, PolylineState>, controller: MapViewControllerInterface): Promise<void>;
}

interface GroundImageFingerPrint {
    id: number;
    bounds: number;
    imageUrl: number;
    opacity: number;
    tileSize: number;
    extra: number;
}
interface GroundImageEvent {
    state: GroundImageState;
    clicked: GeoPoint | null;
}
type OnGroundImageEventHandler = (event: GroundImageEvent) => void;
interface GroundImageState {
    readonly id: string;
    bounds: GeoRectBounds;
    imageUrl: string;
    opacity: number;
    tileSize: number;
    extra: Serializable | null;
    onClick: OnGroundImageEventHandler | null;
    fingerPrint(): GroundImageFingerPrint;
    copy(opts?: GroundImageStateCopyParams): GroundImageState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): {
        subscribe: (fn: (fp: GroundImageFingerPrint) => void) => () => void;
    };
}
interface GroundImageStateCopyParams {
    bounds?: GeoRectBounds;
    imageUrl?: string;
    opacity?: number;
    tileSize?: number;
    extra?: Serializable | null;
    onClick?: OnGroundImageEventHandler | null;
    id?: string | null;
}
declare const GROUND_IMAGE_DEFAULT_TILE_SIZE = 512;
declare function createGroundImageState(params: {
    bounds: GeoRectBounds;
    imageUrl: string;
    opacity?: number;
    tileSize?: number;
    id?: string | null;
    extra?: Serializable | null;
    onClick?: OnGroundImageEventHandler | null;
}): GroundImageState;

interface GroundImageEntity<ActualGroundImage> {
    readonly groundImage: ActualGroundImage;
    readonly state: GroundImageState;
    readonly fingerPrint: GroundImageFingerPrint;
}
declare const createGroundImageEntity: <ActualGroundImage>(params: {
    groundImage: ActualGroundImage;
    state: GroundImageState;
}) => GroundImageEntity<ActualGroundImage>;

interface GroundImageAddParams {
    readonly state: GroundImageState;
}
interface GroundImageChangeParams<ActualGroundImage> {
    readonly current: GroundImageEntity<ActualGroundImage>;
    readonly prev: GroundImageEntity<ActualGroundImage>;
}
interface GroundImageOverlayRenderer<ActualGroundImage> {
    onAdd(data: GroundImageAddParams[]): Promise<(ActualGroundImage | null)[]>;
    onChange(data: GroundImageChangeParams<ActualGroundImage>[]): Promise<(ActualGroundImage | null)[]>;
    onRemove(data: GroundImageEntity<ActualGroundImage>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

declare abstract class AbstractGroundImageOverlayRenderer<MapViewHolderType extends MapViewHolder<unknown, unknown>, ActualGroundImage> implements GroundImageOverlayRenderer<ActualGroundImage> {
    readonly holder: MapViewHolderType;
    constructor(holder: MapViewHolderType);
    abstract createGroundImage(state: GroundImageState): Promise<ActualGroundImage | null>;
    abstract updateGroundImageProperties(params: {
        groundImage: ActualGroundImage;
        current: GroundImageEntity<ActualGroundImage>;
        prev: GroundImageEntity<ActualGroundImage>;
    }): Promise<ActualGroundImage | null>;
    abstract removeGroundImage(entity: GroundImageEntity<ActualGroundImage>): Promise<void>;
    onAdd(data: GroundImageAddParams[]): Promise<(ActualGroundImage | null)[]>;
    onChange(data: GroundImageChangeParams<ActualGroundImage>[]): Promise<(ActualGroundImage | null)[]>;
    onRemove(data: GroundImageEntity<ActualGroundImage>[]): Promise<void>;
    onPostProcess(): Promise<void>;
}

interface GroundImageCapable {
    compositionGroundImages(data: GroundImageState[]): Promise<void>;
    updateGroundImage(state: GroundImageState): Promise<void>;
    /** @deprecated Use GroundImageState.onClick instead. */
    setOnGroundImageClickListener(listener: OnGroundImageEventHandler | null): void;
    hasGroundImage(state: GroundImageState): boolean;
}

interface GroundImageManagerInterface<ActualGroundImage> {
    registerEntity(entity: GroundImageEntity<ActualGroundImage>): void;
    removeEntity(id: string): GroundImageEntity<ActualGroundImage> | null;
    getEntity(id: string): GroundImageEntity<ActualGroundImage> | null;
    hasEntity(id: string): boolean;
    allEntities(): GroundImageEntity<ActualGroundImage>[];
    clear(): void;
    updateEntity(entity: GroundImageEntity<ActualGroundImage>): void;
    find(position: GeoPoint): GroundImageEntity<ActualGroundImage> | null;
}
declare class GroundImageManager<ActualGroundImage> implements GroundImageManagerInterface<ActualGroundImage> {
    private readonly entities;
    registerEntity(entity: GroundImageEntity<ActualGroundImage>): void;
    updateEntity(entity: GroundImageEntity<ActualGroundImage>): void;
    removeEntity(id: string): GroundImageEntity<ActualGroundImage> | null;
    getEntity(id: string): GroundImageEntity<ActualGroundImage> | null;
    hasEntity(id: string): boolean;
    allEntities(): GroundImageEntity<ActualGroundImage>[];
    clear(): void;
    find(position: GeoPoint): GroundImageEntity<ActualGroundImage> | null;
}

declare abstract class GroundImageController<ActualGroundImage> implements OverlayController<GroundImageState, GroundImageEntity<ActualGroundImage>, GroundImageEvent> {
    readonly zIndex: number;
    readonly groundImageManager: GroundImageManagerInterface<ActualGroundImage>;
    readonly renderer: GroundImageOverlayRenderer<ActualGroundImage>;
    clickListener: OnGroundImageEventHandler | null;
    private semaphore;
    constructor({ groundImageManager, renderer, clickListener, }: {
        groundImageManager: GroundImageManagerInterface<ActualGroundImage>;
        renderer: GroundImageOverlayRenderer<ActualGroundImage>;
        clickListener?: OnGroundImageEventHandler | null;
    });
    dispatchClick(event: GroundImageEvent): void;
    composition(data: GroundImageState[]): Promise<void>;
    has(state: GroundImageState): boolean;
    setOnClickListener(listener: OnGroundImageEventHandler | null): void;
    add(data: GroundImageState[]): Promise<void>;
    update(state: GroundImageState): Promise<void>;
    clear(): Promise<void>;
    find(position: GeoPoint): GroundImageEntity<ActualGroundImage> | null;
    onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void>;
    destroy(): void;
}

/**
 * Bridge between the React-side GroundImageState collector and a GroundImageCapable map controller.
 * Mirrors `GroundImageOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the ground image collection changes, the controller's `compositionGroundImages()` is called.
 */
declare class GroundImageOverlay implements MapOverlayInterface<GroundImageState> {
    private readonly collector;
    constructor(collector: OverlayCollector<GroundImageState>);
    subscribe(fn: (data: ReadonlyMap<string, GroundImageState>) => void): () => void;
    render(data: ReadonlyMap<string, GroundImageState>, controller: MapViewControllerInterface): Promise<void>;
}

declare enum TileScheme {
    XYZ = "XYZ",
    TMS = "TMS"
}
type RasterAttributionRule = AttributionRule;
type RasterLayerSource = {
    type: "UrlTemplate";
    template: string;
    tileSize?: number;
    minZoom?: number | null;
    maxZoom?: number | null;
    attributionRules?: AttributionRule[];
    scheme?: TileScheme;
} | {
    type: "TileJson";
    url: string;
} | {
    type: "ArcGisService";
    serviceUrl: string;
};
declare const RasterLayerSource: {
    DEFAULT_TILE_SIZE: number;
    UrlTemplate(params: {
        template: string;
        tileSize?: number;
        minZoom?: number | null;
        maxZoom?: number | null;
        attributionRules?: AttributionRule[];
        scheme?: TileScheme;
    }): RasterLayerSource;
    TileJson(url: string): RasterLayerSource;
    ArcGisService(serviceUrl: string): RasterLayerSource;
};
declare function resolveRasterAttributions(sources: RasterLayerSource[], camera: MapCameraPosition): string[];

/**
 * 明示指定が無いときの `userAgent`。
 *
 * 「利用者が指定した値かどうか」を判定するために公開している。空ではないので、
 * 既定のままの状態まで「指定あり」として扱うと、ラスタレイヤを 1 枚置いただけで
 * 非対応の警告が出てしまう。android-sdk の `RasterLayerState.DEFAULT_USER_AGENT` /
 * ios-sdk の `RasterLayerState.defaultUserAgent` と同じ値・同じ用途。
 */
declare const DEFAULT_RASTER_LAYER_USER_AGENT = "MapConductor/RasterLayerAgent(https://mapconductor.com)";
interface RasterLayerFingerPrint {
    id: number;
    source: number;
    opacity: number;
    visible: number;
    zIndex: number;
    userAgent: number;
    debug: number;
    /** `extraHeaders` のハッシュ。中身が extraHeaders しか無いので名前を実態に合わせている。 */
    extraHeaders: number;
}
interface RasterLayerEvent {
    state: RasterLayerState;
}
type OnRasterLayerEventHandler = (event: RasterLayerEvent) => void;
interface RasterLayerState {
    readonly id: string;
    source: RasterLayerSource;
    opacity: number;
    visible: boolean;
    zIndex: number;
    userAgent: string;
    debug: boolean;
    extraHeaders: Record<string, string> | null;
    fingerPrint(): RasterLayerFingerPrint;
    copy(opts?: RasterLayerStateCopyParams): RasterLayerState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): {
        subscribe: (fn: (fp: RasterLayerFingerPrint) => void) => () => void;
    };
}
interface RasterLayerStateCopyParams {
    source?: RasterLayerSource;
    opacity?: number;
    visible?: boolean;
    zIndex?: number;
    userAgent?: string;
    debug?: boolean;
    extraHeaders?: Record<string, string> | null;
    id?: string | null;
}
declare function createRasterLayerState(params: {
    source: RasterLayerSource;
    opacity?: number;
    visible?: boolean;
    zIndex?: number;
    userAgent?: string;
    debug?: boolean;
    extraHeaders?: Record<string, string> | null;
    id?: string | null;
}): RasterLayerState;

/** 「この宛先へのリクエストにはこのヘッダを載せる」という 1 件の規則。 */
interface RasterHeaderRule {
    /** 適用先ホスト（小文字化済み）。 */
    readonly host: string;
    /** 適用先ポート。URL に明示が無ければ `null`。 */
    readonly port: number | null;
    /** 追加ヘッダ。 */
    readonly extraHeaders: Record<string, string>;
}
/** プロバイダがラスタタイル要求に何を載せられるか。 */
interface RasterHeaderSupport {
    /** ログに出す表示名。 */
    readonly provider: string;
    /** `extraHeaders` をタイル要求に載せられるか。 */
    readonly extraHeaders: boolean;
}
/**
 * ラスタレイヤの `extraHeaders` を、**宛先ホスト単位**で管理する。
 *
 * ## 何のためにあるか
 *
 * 地図ライブラリのリクエスト書き換えフック（maplibre-gl / mapbox-gl / azure-maps の
 * `transformRequest`、ArcGIS の `esriConfig.request.interceptors`）は、**URL しか
 * 受け取らない**。どのラスタレイヤの要求なのかはフック側からは分からないので、
 * 「この URL ならこのヘッダ」という対応表を外に置いておく必要がある。
 *
 * 自分でタイルを取りに行くプロバイダ（Leaflet / OpenLayers / Cesium）は
 * `RasterLayerState` を直接持っているので、この表は使わない。
 *
 * ## なぜホスト単位か
 *
 * `transformRequest` は**地図 1 つにつき 1 つ**で、ベースマップのスタイル・
 * ベクタタイル・スプライトの取得もすべて通る。無条件にヘッダを載せると、
 * ラスタレイヤ用の認証ヘッダが**ベースマップの配信元にも送られる**。
 * 宛先ホストで絞れば、そのラスタタイルを配信しているサーバ宛だけに載る。
 *
 * android-sdk / ios-sdk の `RasterHeaderRuleSet` と同じ構造・同じ意味論。
 * ネイティブ側はフックが**プロセス全体に 1 つ**しかないためさらに事情が厳しいが、
 * 絞る理由そのものは同じ。
 *
 * ## userAgent がここに無い理由
 *
 * ブラウザでは User-Agent が fetch/XHR の forbidden header name で、指定しても
 * 捨てられる。載せられないものを表に持つと「登録できたのだから効くはず」と読めて
 * しまうので、web 側の規則は `extraHeaders` だけにしてある。
 * React Native では値がネイティブ SDK へ渡り、そちらで効く（[warnUnsupported] 参照）。
 */
declare class RasterHeaderRuleSet {
    /** プロバイダ横断で共有する実体。 */
    static readonly shared: RasterHeaderRuleSet;
    /**
     * 登録元 1 つ分の規則。
     *
     * 登録元（コントローラ）は可能なら弱参照で持つ。`removeRules` を呼び忘れても
     * 地図ごとリークさせないため。`WeakRef` が無い実行環境では強参照になるので、
     * その場合は `removeRules` が唯一の解放手段になる（コントローラの `destroy` が呼ぶ）。
     */
    private readonly entries;
    /** 規則が 1 件も無いか。 */
    get isEmpty(): boolean;
    /** 登録元 1 つ分の規則を差し替える。 */
    setRules(rules: RasterHeaderRule[], owner: object): void;
    /** 登録元 1 つ分の規則を外す（破棄時）。 */
    removeRules(owner: object): void;
    /**
     * [url] に載せるべき追加ヘッダ。該当が無ければ `null`。
     *
     * 同じホストに値の違うラスタレイヤが複数あるとき、フックは 1 つしかないので
     * どれか 1 つしか選べない。**後勝ちにはせず**、登録順で最初に一致した規則を使う
     * （順序が決まるので結果が再現する）。ここは android-sdk / ios-sdk と同じ挙動。
     */
    headersFor(url: string): Record<string, string> | null;
    private purge;
    /** レイヤの状態から規則を組み立てる。ヘッダ指定が無い状態は規則を作らない。 */
    static makeRules(states: RasterLayerState[]): RasterHeaderRule[];
    /**
     * 載せられない指定を、黙って無視せずに知らせる。
     *
     * ここで出さないと、利用者は「認証が通らない理由」を自分のサーバ側で探すことになる。
     * android-sdk / ios-sdk の `warnUnsupported` と同じ役割。
     *
     * `userAgent` は**プロバイダに関係なく web では常に非対応**。ブラウザが上書きを
     * 許さないためで、SDK 側で回避する方法は無い。ただしプロパティ自体は残してある:
     * React Native では同じコードがネイティブ SDK へ値を渡し、そちらでは実際に効く。
     * web と RN でコードを分けずに済ませるための意図的な残し方なので、
     * 「効かないなら消す」ではなく「効かない環境では知らせる」を選んでいる。
     */
    static warnUnsupported(support: RasterHeaderSupport, state: RasterLayerState): void;
}
/** `transformRequest` が返す形のうち、ここで触る部分だけ。 */
interface RasterRequestParameters {
    url: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
}
type RasterTransformRequest<ResourceType> = (url: string, resourceType: ResourceType) => RasterRequestParameters | undefined;
/**
 * GL 系ライブラリの `transformRequest` に差し込む関数を作る。
 *
 * maplibre-gl / mapbox-gl / azure-maps はいずれも `transformRequest` を**地図の生成時に
 * 1 つだけ**受け取る。利用者が `options.transformRequest` を渡している場合があるので、
 * 置き換えずに包む。包まないと、利用者が自分で足していた認証ヘッダが消える。
 *
 * 規則は毎回 [RasterHeaderRuleSet.shared] を引く。地図を作ったあとに追加された
 * ラスタレイヤにも効かせるためで、生成時のスナップショットを持つと最初の 1 枚しか
 * 効かない。
 */
declare function withRasterHeaderTransform<ResourceType>(userTransform?: RasterTransformRequest<ResourceType> | null): RasterTransformRequest<ResourceType>;

interface RasterLayerCapable {
    compositionRasterLayers(data: RasterLayerState[]): Promise<void>;
    updateRasterLayer(state: RasterLayerState): Promise<void>;
    hasRasterLayer(state: RasterLayerState): boolean;
}

interface RasterLayerEntity<ActualLayer> {
    readonly layer: ActualLayer;
    readonly state: RasterLayerState;
    readonly fingerPrint: RasterLayerFingerPrint;
}
declare const createRasterLayerEntity: <ActualLayer>(params: {
    layer: ActualLayer;
    state: RasterLayerState;
}) => RasterLayerEntity<ActualLayer>;

interface RasterLayerManagerInterface<ActualLayer> {
    registerEntity(entity: RasterLayerEntity<ActualLayer>): void;
    removeEntity(id: string): RasterLayerEntity<ActualLayer> | null;
    getEntity(id: string): RasterLayerEntity<ActualLayer> | null;
    hasEntity(id: string): boolean;
    allEntities(): RasterLayerEntity<ActualLayer>[];
    clear(): void;
    updateEntity(entity: RasterLayerEntity<ActualLayer>): void;
    find(position: GeoPoint): RasterLayerEntity<ActualLayer> | null;
}
declare class RasterLayerManager<ActualLayer> implements RasterLayerManagerInterface<ActualLayer> {
    private readonly entities;
    registerEntity(entity: RasterLayerEntity<ActualLayer>): void;
    updateEntity(entity: RasterLayerEntity<ActualLayer>): void;
    removeEntity(id: string): RasterLayerEntity<ActualLayer> | null;
    getEntity(id: string): RasterLayerEntity<ActualLayer> | null;
    hasEntity(id: string): boolean;
    allEntities(): RasterLayerEntity<ActualLayer>[];
    clear(): void;
    find(_position: GeoPoint): RasterLayerEntity<ActualLayer> | null;
}

interface RasterLayerAddParams {
    readonly state: RasterLayerState;
}
interface RasterLayerChangeParams<ActualLayer> {
    readonly current: RasterLayerEntity<ActualLayer>;
    readonly prev: RasterLayerEntity<ActualLayer>;
}
interface RasterLayerOverlayRenderer<ActualLayer> {
    onAdd(data: RasterLayerAddParams[]): Promise<(ActualLayer | null)[]>;
    onChange(data: RasterLayerChangeParams<ActualLayer>[]): Promise<(ActualLayer | null)[]>;
    onRemove(data: RasterLayerEntity<ActualLayer>[]): Promise<void>;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
}

declare abstract class RasterLayerController<ActualLayer extends object> implements OverlayController<RasterLayerState, RasterLayerEntity<ActualLayer>, RasterLayerEvent> {
    readonly zIndex: number;
    readonly rasterLayerManager: RasterLayerManagerInterface<ActualLayer>;
    readonly renderer: RasterLayerOverlayRenderer<ActualLayer>;
    clickListener: OnRasterLayerEventHandler | null;
    private semaphore;
    private upsertedIds;
    constructor({ rasterLayerManager, renderer, clickListener, }: {
        rasterLayerManager: RasterLayerManagerInterface<ActualLayer>;
        renderer: RasterLayerOverlayRenderer<ActualLayer>;
        clickListener?: OnRasterLayerEventHandler | null;
    });
    /**
     * このプロバイダがタイル要求に何を載せられるか。
     *
     * 既定は「載せられない」。宣言し忘れたプロバイダは**黙って無視するのではなく
     * 警告が出る**側に倒しておく（逆にすると、対応していないのに対応しているように見える）。
     * 実際に載せられるプロバイダだけが override して `extraHeaders: true` を宣言する。
     */
    protected get headerSupport(): RasterHeaderSupport;
    /**
     * ヘッダ指定の反映と、載せられない指定の通知。
     *
     * すべてのプロバイダがこの基底クラスを通るので、ここに置けば宣言（[headerSupport]）
     * だけで全プロバイダの挙動が決まる。renderer 側に散らすと、対応していないプロバイダが
     * 「何も書かない」ことで黙って無視する形になり、実装漏れと区別できない。
     */
    private syncHeaders;
    composition(data: RasterLayerState[]): Promise<void>;
    has(state: RasterLayerState): boolean;
    setOnClickListener(listener: OnRasterLayerEventHandler | null): void;
    add(data: RasterLayerState[]): Promise<void>;
    update(state: RasterLayerState): Promise<void>;
    upsert(state: RasterLayerState): Promise<void>;
    removeById(id: string): Promise<void>;
    clear(): Promise<void>;
    find(_position: GeoPoint): RasterLayerEntity<ActualLayer> | null;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void>;
    destroy(): void;
}

/**
 * Bridge between the React-side RasterLayerState collector and a RasterLayerCapable map controller.
 * Mirrors `RasterLayerOverlay.kt` in the Android SDK.
 *
 * Register an instance of this class with `MapOverlayRegistry` so that whenever
 * the raster layer collection changes, the controller's `compositionRasterLayers()` is called.
 */
declare class RasterLayerOverlay implements MapOverlayInterface<RasterLayerState> {
    private readonly collector;
    constructor(collector: OverlayCollector<RasterLayerState>);
    subscribe(fn: (data: ReadonlyMap<string, RasterLayerState>) => void): () => void;
    render(data: ReadonlyMap<string, RasterLayerState>, controller: MapViewControllerInterface): Promise<void>;
}

/**
 * Browser-side tile server implemented via a Service Worker interceptor.
 *
 * The Service Worker intercepts requests to `/__tiles/{routeId}/{tileSize}/{z}/{x}/{y}.png`
 * and renders registered SW-side tile data with OffscreenCanvas when possible.
 * If SW-side rendering is unavailable, it forwards requests back to the registered
 * TileProvider on the main thread.
 *
 * For CPU-intensive tile rendering, attach a Web Worker via `attachRenderer()` so that
 * `renderTile()` executes off the main thread. The worker should call
 * `createTileWorkerHandler()` from `@mapconductor/js-sdk-core`.
 */
declare class LocalTileServer {
    readonly baseUrl: string;
    private readonly providers;
    private static instance;
    private static swRegistered;
    private workerRenderer;
    private readonly pendingRequests;
    private nextRequestId;
    private constructor();
    static startServer(): LocalTileServer;
    /**
     * Attach a Web Worker that handles tile rendering via `createTileWorkerHandler()`.
     * When attached, `handleFetch()` delegates `renderTile()` to the worker thread
     * instead of running it on the main thread.
     */
    attachRenderer(worker: Worker): void;
    /** Detach the renderer worker and fall back to main-thread rendering. */
    detachRenderer(): void;
    register(routeId: string, provider: TileProvider): void;
    unregister(routeId: string): void;
    /**
     * Send provider data to the SW and await acknowledgment before returning.
     * This guarantees the SW can render tiles with OffscreenCanvas before the
     * caller adds the raster source (which triggers tile requests immediately).
     *
     * Falls back (resolves) after 500 ms if the SW does not respond — in that
     * case the postMessage fallback path in the SW will handle tile requests
     * using the provider already stored in `this.providers`.
     */
    sendSWRegisterAndWait(routeId: string, data: {
        items: {
            lat: number;
            lng: number;
            iconIndex: number;
        }[];
        icons: {
            bitmap: ImageBitmap;
            anchor: {
                x: number;
                y: number;
            };
            size: {
                width: number;
                height: number;
            };
        }[];
        zoomScales: number[];
        extraIconScale: number;
    }): Promise<void>;
    private postToSW;
    urlTemplate({ routeId, tileSize, cacheKey, }: {
        routeId: string;
        tileSize: number;
        cacheKey?: string;
    }): string;
    handleFetch(routeId: string, request: TileRequest): Promise<Uint8Array | null>;
    handleFetchDataUrl(routeId: string, request: TileRequest): string | null;
    private dispatchToWorker;
    /**
     * Register a Service Worker that intercepts `/__tiles/` requests and routes them
     * to `handleFetch()` on the main thread.
     *
     * Call once at app startup, before the map is rendered. The page URL template
     * returned by `urlTemplate()` will then be resolvable by the browser.
     *
     * @param swPath Path to the tile service worker script (default: `/tile-sw.js`)
     */
    startServiceWorker(swPath?: string): void;
    hasProvider(routeId: string): boolean;
    /**
     * Returns true when Service Workers are available in the current context.
     * SW requires a secure origin (HTTPS or localhost). On plain HTTP non-localhost
     * origins (e.g. a local IP like 192.168.x.x), SW is unavailable and tile
     * rendering must use a provider-specific fallback to avoid unresolvable tile URLs.
     */
    static isServiceWorkerSupported(): boolean;
    /**
     * Resolves when the Service Worker is controlling the current page.
     * Returns immediately if the SW already controls the page.
     * Use this to avoid requesting tiles before the SW intercept is active.
     */
    waitForController(): Promise<void>;
}

declare const TileServerRegistry: {
    private_server: LocalTileServer | null;
    get(): LocalTileServer;
    warmup(): void;
};

/**
 * Call this inside a Web Worker to handle tile rendering requests from LocalTileServer.
 *
 * Usage in your worker file:
 * ```ts
 * import { createTileWorkerHandler } from '@mapconductor/js-sdk-core';
 *
 * createTileWorkerHandler({
 *   'my-layer': {
 *     renderTile({ x, y, z }) {
 *       return generateTileBytes(x, y, z);
 *     },
 *   },
 * });
 * ```
 * Then on the main thread:
 * ```ts
 * const worker = new Worker(new URL('./my-layer.worker.ts', import.meta.url), { type: 'module' });
 * LocalTileServer.startServer().attachRenderer(worker);
 * ```
 */
declare function createTileWorkerHandler(providers: Record<string, TileProvider>): void;

interface TileRenderRequest {
    readonly type: 'render';
    readonly id: number;
    readonly routeId: string;
    readonly request: TileRequest;
}
interface TileRenderResponse {
    readonly type: 'render';
    readonly id: number;
    readonly result: Uint8Array | null;
}

declare abstract class AbstractZoomAltitudeConverter {
    protected readonly zoom0Altitude: number;
    static readonly DEFAULT_ZOOM0_ALTITUDE = 171319879;
    static readonly ZOOM_FACTOR = 2;
    static readonly MIN_ZOOM_LEVEL = 0;
    static readonly MAX_ZOOM_LEVEL = 22;
    static readonly MIN_ALTITUDE = 100;
    static readonly MAX_ALTITUDE = 50000000;
    static readonly MIN_COS_LAT = 0.01;
    static readonly MIN_COS_TILT = 0.05;
    static readonly WEB_MERCATOR_INITIAL_MPP_256 = 156543.033928;
    constructor(zoom0Altitude?: number);
    abstract zoomLevelToAltitude(params: {
        zoomLevel: number;
        latitude: number;
        tilt: number;
    }): number;
    abstract altitudeToZoomLevel(params: {
        altitude: number;
        latitude: number;
        tilt: number;
    }): number;
}

declare abstract class AbstractMarkerController<ActualMarker> implements OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState> {
    readonly zIndex: number;
    private defaultIcon;
    private readonly draggingStates;
    /** タイル描画中のマーカー ID。android-sdk の各プロバイダが持つ tiledMarkerIds に対応する。 */
    protected readonly tiledMarkerIds: Set<string>;
    dragStartListener: OnMarkerEventHandler | null;
    dragListener: OnMarkerEventHandler | null;
    dragEndListener: OnMarkerEventHandler | null;
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;
    /** 直近のカメラ位置。サブクラスのヒットテスト等が参照する。 */
    protected mapCameraPosition: MapCameraPosition | null;
    private semaphore;
    markerManager: MarkerManager<ActualMarker>;
    renderer: MarkerOverlayRenderer<ActualMarker>;
    clickListener: OnMarkerEventHandler | null;
    constructor({ markerManager, renderer, clickListener, }: {
        markerManager: MarkerManager<ActualMarker>;
        renderer: MarkerOverlayRenderer<ActualMarker>;
        clickListener?: OnMarkerEventHandler | null;
    });
    /**
     * Nearest-entity lookup. Providers with icon-bounds hit testing
     * (screen-space tolerance) override this.
     */
    find(position: GeoPoint): MarkerEntity<ActualMarker> | null;
    composition(data: MarkerState[]): Promise<void>;
    has(state: MarkerState): boolean;
    setOnClickListener(listener: OnMarkerEventHandler | null): void;
    setOnDragStart(listener: OnMarkerEventHandler | null): void;
    setOnDrag(listener: OnMarkerEventHandler | null): void;
    setOnDragEnd(listener: OnMarkerEventHandler | null): void;
    setOnAnimateStart(listener: OnMarkerEventHandler | null): void;
    setOnAnimateEnd(listener: OnMarkerEventHandler | null): void;
    /**
     * Return true if this marker should be rendered as a tile rather than an individual overlay.
     * `totalCount` is the total number of markers in the current composition call.
     */
    protected shouldTile(_state: MarkerState, _totalCount: number): boolean;
    dispatchClick(state: MarkerState): void;
    dispatchDragStart(state: MarkerState): void;
    dispatchDrag(state: MarkerState): void;
    dispatchDragEnd(state: MarkerState): void;
    dispatchAnimateStart(state: MarkerState): void;
    dispatchAnimateEnd(state: MarkerState): void;
    protected setDraggingState(markerState: MarkerState, dragging: boolean): void;
    protected isDragging(markerState: MarkerState): boolean;
    add(data: MarkerState[]): Promise<void>;
    /** Called when tiled markers are added or updated. Override in subclasses to manage tile overlay. */
    protected onTiledMarkersChanged(): Promise<void>;
    /** Called after a provider marker is created and registered. */
    protected onMarkerAdded(_entity: MarkerEntity<ActualMarker>): void;
    update(state: MarkerState): Promise<void>;
    clear(): Promise<void>;
    onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void>;
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    destroy(): void;
}

/**
 * Abstract base class implementing the listener-management contract of MapViewControllerInterface.
 * Concrete SDK controllers extend this and call notify*() methods when native events fire.
 *
 * Mirrors Android BaseMapViewController / iOS MapViewController (base methods).
 */
declare abstract class BaseMapViewController {
    protected cameraMoveStartCallback: OnCameraMoveHandler | null;
    protected cameraMoveCallback: OnCameraMoveHandler | null;
    protected cameraMoveEndCallback: OnCameraMoveHandler | null;
    protected mapClickCallback: OnMapEventHandler | null;
    protected mapLongClickCallback: OnMapEventHandler | null;
    protected mapInitializedCallback: OnMapInitializedHandler | null;
    private mapInitialized;
    private mapInitializedCallbackDelivered;
    private readonly overlayControllers;
    /**
     * ネイティブ SDK に直接のカメラ範囲制限 API を持たないプロバイダ（HERE/ArcGIS/MapKit/Cesium）が
     * クランプ方式で使う制限設定。ネイティブ API を持つプロバイダ（Mapbox/MapLibre/MapTiler/
     * TomTom/Google/Leaflet/OpenLayers/Azure Maps）は `setCameraRestriction` をオーバーライドして
     * 直接適用するため、この値は使わない。
     */
    private cameraRestriction;
    setCameraRestriction(restriction: CameraRestriction | null): void;
    protected hasCameraRestriction(): boolean;
    /**
     * カメラ位置が `setCameraRestriction` の制限に違反していれば補正後の位置を返す。違反が無ければ null。
     *
     * ズームは統一ズーム（Google 準拠）前提。範囲制限はネイティブの
     * `setLatLngBoundsForCameraTarget` 相当（カメラ中心を矩形内へクランプ）のセマンティクスに揃える。
     * クランプ方式のプロバイダはカメラ停止時にこれを呼び、返り値があれば `moveCamera` で再適用する。
     * ε を用いて微小な誤差では補正しないことで、再適用 → イベント → 再補正の無限ループを防ぐ。
     *
     * android-sdk の `BaseMapViewController.cameraRestrictionCorrection` の移植。ε の値も同一。
     */
    protected cameraRestrictionCorrection(current: MapCameraPosition): MapCameraPosition | null;
    setCameraMoveStartListener(listener: OnCameraMoveHandler | null): void;
    setCameraMoveListener(listener: OnCameraMoveHandler | null): void;
    setCameraMoveEndListener(listener: OnCameraMoveHandler | null): void;
    setMapClickListener(listener: OnMapEventHandler | null): void;
    setMapLongClickListener(listener: OnMapEventHandler | null): void;
    setMapInitializedListener(listener: OnMapInitializedHandler | null): void;
    /**
     * オーバーレイコントローラを登録する。
     *
     * 登録したコントローラには `notifyMapCameraPosition` からカメラ変更が伝播し、
     * `destroy()` で一括破棄される。android-sdk の
     * `BaseMapViewController.registerOverlayController` に対応する。
     */
    registerOverlayController(controller: OverlayControllerLike): void;
    /** 登録を解除する。拡張コンポーネントのアンマウント時に呼ぶ。 */
    unregisterOverlayController(controller: OverlayControllerLike): void;
    protected notifyCameraMoveStart(camera: MapCameraPosition): void;
    protected notifyCameraMove(camera: MapCameraPosition): void;
    protected notifyCameraMoveEnd(camera: MapCameraPosition): void;
    /**
     * カメラ停止時に制限違反があれば補正位置へ移動し直す。
     *
     * ネイティブの範囲制限 API を持たないプロバイダ（HERE / ArcGIS / MapKit / Cesium /
     * OpenLayers / Longdo）はこの経路で制限が効く。ネイティブ API を持つプロバイダは
     * `setCameraRestriction` をオーバーライドして `super` を呼ばないため、
     * ここでは何も起きない（android-sdk と同じ振り分け）。
     *
     * 補正したら true。ε による不感帯があるので、再適用 → moveend → 再補正 のループにはならない。
     */
    protected applyCameraRestrictionOnIdle(camera: MapCameraPosition): boolean;
    protected notifyMapClick(point: GeoPoint): void;
    protected notifyMapLongClick(point: GeoPoint): void;
    /**
     * マップ初期化を記録し、リスナーが揃った時点で1回だけ配送する。
     *
     * プロバイダのコントローラは、React 側の effect がリスナーを張り終える前に初期化を
     * 完了させることがある（effect はマウント後に走るため）。sticky にしておくことで、
     * その隙間で初期化完了が取りこぼされるのを防ぐ。
     * android-sdk の `notifyMapInitialized` / `deliverMapInitializedCallbackIfReady` の移植。
     */
    protected notifyMapInitialized(): void;
    private deliverMapInitializedCallbackIfReady;
    /**
     * カメラ変更を登録済みオーバーレイコントローラへ伝播し、続けて利用者コールバックを呼ぶ。
     *
     * android-sdk の `notifyMapCameraPosition` に対応する。プロバイダが個別に
     * `Promise.all([...onCameraChanged])` を書く必要がなくなり、拡張機能
     * （marker-clustering 等）も自前でリスナースロットを奪わずにカメラ変更を受け取れる。
     */
    protected notifyMapCameraPosition(camera: MapCameraPosition): Promise<void>;
    destroy(): void;
}

interface ChangeParamsInterface<EntityType> {
    readonly current: EntityType;
    readonly prev: EntityType;
}
interface OverlayRendererInterface<ActualType, StateType, EntityType> {
    onAdd(data: StateType[]): Promise<Array<ActualType | null>> | Array<ActualType | null>;
    onChange(data: Array<ChangeParamsInterface<EntityType>>): Promise<Array<ActualType | null>> | Array<ActualType | null>;
    onRemove(data: EntityType[]): Promise<void> | void;
    onPostProcess(): Promise<void> | void;
}

interface NativeMapExtensionDescriptor {
    readonly id: string;
    readonly type: string;
    readonly payload: Record<string, unknown>;
}
interface NativeMapExtensionEvent {
    readonly extensionId: string;
    readonly eventName: string;
    readonly payload: Record<string, unknown>;
}
type NativeMapExtensionEventHandler = (event: NativeMapExtensionEvent) => void;
interface NativeMapExtensionCapable extends MapViewControllerInterface {
    upsertNativeMapExtension(extension: NativeMapExtensionDescriptor, eventHandler?: NativeMapExtensionEventHandler | null): void;
    removeNativeMapExtension(extensionId: string): void;
}
declare function isNativeMapExtensionCapable(controller: MapViewControllerInterface | null): controller is NativeMapExtensionCapable;

interface InfoBubbleEntry {
    readonly id: string;
    readonly positionProvider: () => GeoPoint;
    readonly icon: MarkerIcon | null;
    readonly tailOffset: Offset;
    readonly content: unknown;
}

interface MarkerOptions extends Partial<Omit<MarkerState, 'fingerPrint'>> {
    position: GeoPoint;
    id?: string;
    title?: string;
    zIndex?: number;
    opacity?: number;
}
interface CircleOptions {
    id?: string;
    center: GeoPoint;
    radius: number;
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    clickable?: boolean;
    visible?: boolean;
    zIndex?: number;
}
interface PolylineOptions {
    id?: string;
    path: GeoPoint[];
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    clickable?: boolean;
    visible?: boolean;
    zIndex?: number;
}
interface PolygonOptions {
    id?: string;
    path: GeoPoint[];
    holes?: GeoPoint[][];
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    clickable?: boolean;
    visible?: boolean;
    zIndex?: number;
}
interface GroundOverlayOptions {
    id?: string;
    bounds: GeoRectBounds;
    imageUrl: string;
    opacity?: number;
    clickable?: boolean;
    visible?: boolean;
    zIndex?: number;
}

/**
 * Marker icon sizes shared by the bundled icon renderers.
 *
 * Mirrors `com.mapconductor.settings.MarkerIconSize` (Android) and `MarkerIconSize`
 * in `MapConductorCore` (iOS).
 */
declare const MarkerIconSize: Readonly<{
    Small: 32;
    Regular: 48;
    Large: 60;
}>;
/**
 * SDK-wide tuning constants.
 *
 * Mirrors `com.mapconductor.settings.Settings` (Android) and `Settings` in
 * `MapConductorCore` (iOS); member names and values are kept in sync across the
 * three platforms so that behaviour is portable.
 *
 * Lengths are CSS pixels here, `dp` on Android and points on iOS. Durations are in
 * milliseconds on all three platforms.
 */
declare const Settings: Readonly<{
    Default: Readonly<{
        tapTolerance: 48;
        markerDropAnimateDuration: 300;
        markerBounceAnimateDuration: 2000;
        iconSize: 48;
        iconStroke: 1;
        composeEventDebounce: 5;
    }>;
}>;

/**
 * The gesture handlers MapLibre GL JS exposes on its map object.
 *
 * Mapbox GL JS, the MapTiler SDK and the TomTom Maps SDK are all MapLibre/Mapbox
 * GL forks and expose the same handlers, so the four providers share one
 * implementation. Typed structurally rather than against any one SDK's types so
 * that this stays in the core package.
 */
interface GlGestureHandler {
    enable(): void;
    disable(): void;
}
interface GlTouchZoomRotateHandler extends GlGestureHandler {
    enableRotation(): void;
    disableRotation(): void;
}
interface GlGestureHandlers {
    dragPan: GlGestureHandler;
    scrollZoom: GlGestureHandler;
    doubleClickZoom: GlGestureHandler;
    touchZoomRotate: GlTouchZoomRotateHandler;
    dragRotate: GlGestureHandler;
    touchPitch: GlGestureHandler;
}
/**
 * Applies {@link MapUISettings} to a MapLibre-GL-style map.
 *
 * Two handlers cover more than one gesture, and neither can be split apart, so
 * the flags cannot always be honoured independently:
 *
 * - `touchZoomRotate` drives both pinch-zoom and pinch-rotate. It has to stay on
 *   for either, so disabling zoom while rotation is still wanted leaves
 *   pinch-zoom working.
 * - `dragRotate` rotates *and* pitches on a right-button drag, so a map that
 *   allows rotation also allows tilting with the mouse.
 *
 * Each case logs a one-time warning naming the gesture that stays available.
 */
declare function applyGlMapUISettings(map: Partial<GlGestureHandlers> | null | undefined, settings: MapUISettings, provider: string): void;

/** 円リング近似の既定分割数。 */
declare const DEFAULT_CIRCLE_SEGMENTS = 128;
/** 経度を [-180, 180] へ正規化する（geometry モジュール共有ヘルパー）。 */
declare function normalizeLngDegrees(lng: number): number;
/**
 * 円を頂点列（開いたリング）へ変換する共通ジオメトリ。各アダプターはこの結果を
 * 自 SDK の型へ変換して描画するだけにする（円の形状定義を全プロバイダで統一する）。
 *
 * - geodesic=true : 球面上で中心から等距離のリング（`Spherical.computeOffset`）。
 * - geodesic=false: 中心緯度の局所平面（正距円筒）近似での等距離リング。
 *   小さな半径・低〜中緯度では geodesic とほぼ一致する。
 *
 * 経度は中心経度まわりに連続化（unwrap）して返す。±180 を跨ぐ円でも経度が飛ばないため、
 * 範囲外経度を扱える GL 系 SDK（Mapbox GL / MapLibre GL 等）はこのまま 1 枚の
 * ポリゴンとして描画できる（子午線の継ぎ目が出ない）。経度 ±180 に制約のある SDK は、
 * 各点を normalize してから `splitRingByMeridian` で分割すること。
 *
 * リングは閉じていない（必要なら `closeRing` を使う）。半径 0 以下・分割数 3 未満は
 * 空配列を返す。android-sdk / ios-sdk の `circleToRing` と同一仕様。
 */
declare function circleToRing(center: GeoPoint, radiusMeters: number, geodesic: boolean, segments?: number): GeoPoint[];
/** リングが閉じていなければ先頭点を末尾へ追加して閉じる。 */
declare function closeRing(ring: GeoPoint[]): GeoPoint[];

/** ポリゴンの外周リングと穴リング。リングは閉じていない。 */
interface PolygonRings {
    outerRings: GeoPoint[][];
    holeRings: GeoPoint[][];
}
/** geodesic に応じた補間で点列を密度化し、緯度経度を正規化して返す。 */
declare function densifyAndNormalize(points: GeoPoint[], geodesic: boolean, maxSegmentLength?: number): GeoPoint[];
/**
 * ポリライン用パイプライン（分割版）。密度化・正規化後に子午線で分割したセグメント列を返す。
 * 頂点 2 未満の入力、および分割で 2 点未満になったセグメントは除く（空配列になり得る）。
 */
declare function buildPolylineSegments(points: GeoPoint[], geodesic: boolean): GeoPoint[][];
/**
 * ポリゴン用パイプライン（分割版）。外周を密度化→分割し、穴も同じ方式で密度化する。
 *
 * 外周が子午線で複数リングに分割された場合、穴を分割後の各ピースへ再割当てできないため
 * 穴を含めない（従来から全 GeoJSON 系ドライバー共通の仕様）。頂点 3 未満の外周入力は
 * 空の結果を返し、3 点未満に縮退したリングは除外する。
 */
declare function buildPolygonRings(points: GeoPoint[], holes: GeoPoint[][], geodesic: boolean): PolygonRings;
/**
 * ポリライン用パイプライン（unwrap 版）。密度化後に経度を連続化した単一パスを返す。
 * 頂点 2 未満の入力は空配列を返す。
 */
declare function buildUnwrappedPolylinePath(points: GeoPoint[], geodesic: boolean, maxSegmentLength?: number): GeoPoint[];
/**
 * ポリゴン用パイプライン（unwrap 版）。外周・穴とも密度化し、外周の先頭経度を基準に
 * 同一の連続座標系へ unwrap する（±180 跨ぎでも常に外周 1 リング + 全穴を返せる）。
 * 頂点 3 未満の外周入力は空の結果を返し、3 点未満に縮退した穴は除外する。
 */
declare function buildUnwrappedPolygonRings(points: GeoPoint[], holes: GeoPoint[][], geodesic: boolean, maxSegmentLength?: number): PolygonRings;

/**
 * WebView 系ドライバー（MapTiler／Longdo 等）向けの GeoJSON Feature 文字列ビルダー。
 *
 * 座標は経度・緯度の順。properties は常に空オブジェクトで、数値座標のみを扱うため
 * エスケープは不要。出力形式は android-sdk / ios-sdk の実装と互換。
 */
declare const OverlayGeoJson: {
    /** MultiLineString の Feature を生成する。セグメントが空なら null。 */
    multiLineStringFeature(segments: GeoPoint[][]): string | null;
    /**
     * Polygon（外周 1 つ＋穴）または MultiPolygon（外周複数、穴なし）の Feature を生成する。
     * 各リングは自動的に閉じる。外周が空なら null。
     */
    polygonFeature(rings: PolygonRings): string | null;
    /** 穴のないリング列（円の分割結果等）を Polygon／MultiPolygon の Feature へ変換する。 */
    ringsFeature(rings: GeoPoint[][]): string | null;
};

/**
 * 閉じたリング（開いた頂点列として渡す）を ±180 子午線で分割する。
 *
 * `splitByMeridian` は開いたパス用で、末尾→先頭のラップセグメントを見ないため、
 * 子午線を偶数回跨ぐリングでは「最初の断片」と「最後の断片」が本来ひとつながりの
 * ピースなのに別々に閉じられ、隙間（くさび）が生じる。ここでは最初の交差の直後から
 * 始まるようにリングを回転させ、ラップセグメントも含めて分割したうえで、先頭と末尾の
 * 断片を結合して正しいピース分割を返す。
 *
 * 交差が無ければ入力リングをそのまま 1 断片として返す。
 * android-sdk / ios-sdk の `splitRingByMeridian` と同一仕様。
 */
declare function splitRingByMeridian(ring: GeoPoint[], geodesic: boolean): GeoPoint[][];

declare function toRadians(degrees: number): number;
declare function toDegrees(radians: number): number;

declare function computeDistanceBetween$1(from: GeoPoint, to: GeoPoint): number;
declare function computeHeading$1(from: GeoPoint, to: GeoPoint): number;
declare function computeOffset$1({ origin, distance, heading, }: {
    origin: GeoPoint;
    distance: number;
    heading: number;
}): GeoPoint;
declare function computeOffsetOrigin$1({ to, distance, heading, }: {
    to: GeoPoint;
    distance: number;
    heading: number;
}): GeoPoint | null;
declare function computeLength$1(path: GeoPoint[]): number;
declare function computeArea$1(path: GeoPoint[]): number;
declare function computeSignedArea$1(path: GeoPoint[]): number;
declare function interpolate$1({ from, to, fraction, }: {
    from: GeoPoint;
    to: GeoPoint;
    fraction: number;
}): GeoPoint;

declare namespace Spherical {
  export { computeArea$1 as computeArea, computeDistanceBetween$1 as computeDistanceBetween, computeHeading$1 as computeHeading, computeLength$1 as computeLength, computeOffset$1 as computeOffset, computeOffsetOrigin$1 as computeOffsetOrigin, computeSignedArea$1 as computeSignedArea, interpolate$1 as interpolate };
}

declare function densifyAlongGeodesic(points: GeoPoint[], maxSegmentLength?: number): GeoPoint[];

type GeodesicPointDistancePair = [GeoPoint, number];
declare function geodesicPointOnLineOrNull({ from, to, position, thresholdMeters, }: {
    from: GeoPoint;
    to: GeoPoint;
    position: GeoPoint;
    thresholdMeters: number;
}): GeodesicPointDistancePair | null;

declare function computeDistanceBetween(from: GeoPoint, to: GeoPoint): number;
declare function computeHeading(from: GeoPoint, to: GeoPoint): number;
declare function computeOffset({ origin, distance, heading, }: {
    origin: GeoPoint;
    distance: number;
    heading: number;
}): GeoPoint;
declare function computeOffsetOrigin({ to, distance, heading, }: {
    to: GeoPoint;
    distance: number;
    heading: number;
}): GeoPoint | null;
declare function computeLength(path: GeoPoint[]): number;
declare function computeSignedArea(path: GeoPoint[]): number;
declare function computeArea(path: GeoPoint[]): number;
declare function interpolate({ from, to, fraction, }: {
    from: GeoPoint;
    to: GeoPoint;
    fraction: number;
}): GeoPoint;

declare const WGS84Geodesic_computeArea: typeof computeArea;
declare const WGS84Geodesic_computeDistanceBetween: typeof computeDistanceBetween;
declare const WGS84Geodesic_computeHeading: typeof computeHeading;
declare const WGS84Geodesic_computeLength: typeof computeLength;
declare const WGS84Geodesic_computeOffset: typeof computeOffset;
declare const WGS84Geodesic_computeOffsetOrigin: typeof computeOffsetOrigin;
declare const WGS84Geodesic_computeSignedArea: typeof computeSignedArea;
declare const WGS84Geodesic_interpolate: typeof interpolate;
declare namespace WGS84Geodesic {
  export { WGS84Geodesic_computeArea as computeArea, WGS84Geodesic_computeDistanceBetween as computeDistanceBetween, WGS84Geodesic_computeHeading as computeHeading, WGS84Geodesic_computeLength as computeLength, WGS84Geodesic_computeOffset as computeOffset, WGS84Geodesic_computeOffsetOrigin as computeOffsetOrigin, WGS84Geodesic_computeSignedArea as computeSignedArea, densifyAlongGeodesic as createInterpolatePoints, WGS84Geodesic_interpolate as interpolate, geodesicPointOnLineOrNull as pointOnLineOrNull };
}

declare function planarInterpolate({ from, to, fraction, }: {
    from: GeoPoint;
    to: GeoPoint;
    fraction: number;
}): GeoPoint;

/**
 * 非測地線（直線補間）の点列を密度化する。
 *
 * 分割数はセグメント長に応じて決める（densifyAlongGeodesic と同じ方式）。固定分割だと
 * 短いセグメントが多い多頂点ポリゴンで点数が頂点数×分割数に膨れ上がり、描画が極端に
 * 遅くなるため、maxSegmentLength を超えるセグメントのみ分割する。
 * android-sdk / ios-sdk と同一仕様。
 */
declare function densifyAlongStraightLine(points: GeoPoint[], maxSegmentLength?: number): GeoPoint[];

type PointDistancePair = [GeoPoint, number];
declare function linearPointOnLineOrNull({ from, to, position, thresholdMeters, }: {
    from: GeoPoint;
    to: GeoPoint;
    position: GeoPoint;
    thresholdMeters: number;
}): PointDistancePair | null;

declare namespace Planar {
  export { densifyAlongStraightLine as createInterpolatePoints, planarInterpolate as interpolate, linearPointOnLineOrNull as pointOnLineOrNull };
}

declare function calculateMetersPerPixel({ latitude, zoom, tileSize, }: {
    latitude: number;
    zoom: number;
    tileSize?: number;
}): number;

declare function closestPointOnSegment({ startPoint, endPoint, testPoint, }: {
    startPoint: Offset;
    endPoint: Offset;
    testPoint: Offset;
}): Offset;

declare function createOppositeMeridianPoint(point: GeoPoint): GeoPoint;

declare function expandBounds(bounds: GeoRectBounds, margin: number): GeoRectBounds;

declare function interpolateAtMeridianGeodesic(from: GeoPoint, to: GeoPoint): GeoPoint;

declare function interpolateAtMeridianLinear(from: GeoPoint, to: GeoPoint): GeoPoint;

declare function createSegmentBounds({ point1, point2, geodesic, }: {
    point1: GeoPoint;
    point2: GeoPoint;
    geodesic?: boolean;
}): GeoRectBounds;
declare function segmentIntersectsRegion({ start, end, region, geodesic, }: {
    start: GeoPoint;
    end: GeoPoint;
    region: GeoRectBounds;
    geodesic?: boolean;
}): boolean;

declare function splitByMeridian(points: GeoPoint[], geodesic: boolean): GeoPoint[][];

export { AbstractCircleOverlayRenderer, AbstractGroundImageOverlayRenderer, AbstractMarkerController, AbstractMarkerIcon, AbstractMarkerOverlayRenderer, AbstractMarkerRenderingStrategy, AbstractPolygonOverlayRenderer, AbstractPolylineOverlayRenderer, AbstractViewportStrategy, AbstractZoomAltitudeConverter, type AddParams, type AnyMarkerRenderingSupport, type AttributionRule, BaseMapViewController, type BitmapIcon, type CameraOptions, type CameraRestriction, type ChangeParams, type ChangeParamsInterface, type CircleAddParams, type CircleCapable, type CircleChangeParams, CircleController, type CircleEntity, type CircleEvent, type CircleFingerPrint, CircleManager, type CircleManagerInterface, type CircleOptions, CircleOverlay, type CircleOverlayRenderer, type CircleState, type CircleStateCopyParams, CollectorMarkerOverlayRenderer, ColorDefaultIcon, type CreateMarkerStateParams, DEFAULT_CIRCLE_SEGMENTS, DEFAULT_RASTER_LAYER_USER_AGENT, DefaultMarkerIcon, type DefaultMarkerIconOptions, Direction6, Direction6Delta, Earth, EmptyMapServiceRegistry, type FitBoundsCameraResult, GROUND_IMAGE_DEFAULT_TILE_SIZE, GeoGridIndex, GeoPoint, type GeoPointInterface, type GeoRectBounds, type GlGestureHandler, type GlGestureHandlers, type GlTouchZoomRotateHandler, type GroundImageAddParams, type GroundImageCapable, type GroundImageChangeParams, GroundImageController, type GroundImageEntity, type GroundImageEvent, type GroundImageFingerPrint, GroundImageManager, type GroundImageManagerInterface, GroundImageOverlay, type GroundImageOverlayRenderer, type GroundImageState, type GroundImageStateCopyParams, type GroundOverlayOptions, type HexCell, HexCellRegistry, type HexCellWithDistance, type HexCoord, type HexGeocell, HexGeocellImpl, type HexGeocell as HexGeocellInterface, IconImageCache, type IdentifiedHexCell, ImageDefaultIcon, type ImageDefaultIconOptions, ImageIcon, type ImageIconOptions, type ImageSource, type InfoBubbleEntry, InitState, KDTree, type KDTreeStats, LocalTileServer, MARKER_HIT_RADIUS_MOUSE_PX, MARKER_HIT_RADIUS_TOUCH_PX, MARKER_RENDER_BATCH_SIZE, MapCameraPosition, type MapCameraPositionCopyParams, type MapCameraPositionInterface, type MapConfig, type MapDesignTypeInterface, type MapGesture, type MapOverlayInterface, MapOverlayRegistry, MapPaddings, type MapPaddingsInterface, MapProjection, MapProvider, MapProviderType, type MapServiceKey, type MapServiceRegistry, MapUISettings, MapUISettingsDiagnostics, MapViewBase, type MapViewBaseProps, type MapViewControllerInterface, type MapViewHolder, MapViewHolderBase, MapViewState, type MapViewStateInterface, type MapViewStateInternal, MarkerAnimation, type MarkerAnimationOverlayEntry, type MarkerAnimationOverlayHost, type MarkerCapable, type MarkerEntity, type MarkerEventController, type MarkerFingerPrint, type MarkerIcon, MarkerIconSize, type MarkerIngestionResult, MarkerManager, type MarkerManagerStats, type MarkerOptions, MarkerOverlay, type MarkerOverlayRenderer, type MarkerRenderingStrategy, type MarkerRenderingSupport, MarkerRenderingSupportKey, type MarkerState, type MarkerStateCopyParams, MarkerTileRenderer, MarkerTilingOptions, MutableMapServiceRegistry, Mutex, type NativeMapExtensionCapable, type NativeMapExtensionDescriptor, type NativeMapExtensionEvent, type NativeMapExtensionEventHandler, NoCameraRestriction, type Offset, type OnCameraMoveHandler, type OnCircleEventHandler, type OnGroundImageEventHandler, type OnMapEventHandler, type OnMapInitializedHandler, type OnMapLoadedHandler, type OnMarkerEventHandler, type OnPolygonEventHandler, type OnPolylineEventHandler, type OnRasterLayerEventHandler, OverlayCollector, type OverlayController, type OverlayControllerLike, OverlayGeoJson, type OverlayRendererInterface, Planar, type PolygonAddParams, type PolygonCapable, type PolygonChangeParams, PolygonController, type PolygonEntity, type PolygonEvent, type PolygonFingerPrint, PolygonManager, type PolygonManagerInterface, type PolygonOptions, PolygonOverlay, type PolygonOverlayRenderer, type PolygonRings, type PolygonState, type PolygonStateCopyParams, type PolylineAddParams, type PolylineCapable, type PolylineChangeParams, PolylineController, type PolylineEntity, type PolylineEvent, type PolylineFingerPrint, type PolylineHitResult, PolylineManager, type PolylineManagerInterface, type PolylineOptions, PolylineOverlay, type PolylineOverlayRenderer, type PolylineState, type PolylineStateCopyParams, type PreparedMarker, type Projection, type RasterAttributionRule, type RasterHeaderRule, RasterHeaderRuleSet, type RasterHeaderSupport, type RasterLayerAddParams, type RasterLayerCapable, type RasterLayerChangeParams, RasterLayerController, type RasterLayerEntity, type RasterLayerEvent, type RasterLayerFingerPrint, RasterLayerManager, type RasterLayerManagerInterface, RasterLayerOverlay, type RasterLayerOverlayRenderer, RasterLayerSource, type RasterLayerState, type RasterLayerStateCopyParams, type RasterRequestParameters, type RasterTransformRequest, type RegistryStats, type ScreenOffsetResult, type Serializable, Settings, type SpatialIndex, type SpatialIndexConfig, Spherical, StrategyMarkerController, type TileProvider, type TileRenderRequest, type TileRenderResponse, type TileRequest, TileScheme, TileServerRegistry, type VisibleRegion, WEB_MERCATOR_MAX_EXTENT_METERS, WGS84, WGS84Geodesic, WebMercator, applyGlMapUISettings, bounceInterpolation, bridgeHolesIntoSingleRing, bridgeHolesIntoSingleRingWrapAware, buildPolygonRings, buildPolylineSegments, buildUnwrappedPolygonRings, buildUnwrappedPolylinePath, calculateMetersPerPixel, circleToRing, closeRing, closestPointOnSegment, combineHash, computeArea$1 as computeArea, computeDistanceBetween$1 as computeDistanceBetween, computeFitBoundsCameraPosition, computeHeading$1 as computeHeading, computeLength$1 as computeLength, computeOffset$1 as computeOffset, computeOffsetOrigin$1 as computeOffsetOrigin, computeSignedArea$1 as computeSignedArea, computeDistanceBetween as computeWGS84DistanceBetween, createCircleEntity, createCircleState, createCollectorMarkerRenderingSupport, createDefaultIcon, createFingerPrint, createGeoPoint, createGeoRectBounds, createGroundImageEntity, createGroundImageState, createHexCell, createHexCellWithDistance, createHexCoord, createIdentifiedHexCell, createMapCameraPosition, createMapServiceKey, createMarkerEntity, createMarkerFingerPrint, createMarkerState, createOffset, createOppositeMeridianPoint, createPolygonEntity, createPolygonState, createPolylineEntity, createPolylineState, createRandomId, createRasterLayerEntity, createRasterLayerState, createSegmentBounds, createSubject, createTileWorkerHandler, densifyAndNormalize, expandBounds, fingerPrintEquals, fromGeoPoint, fromLatLng, fromLatLong, fromLngLat, fromLongLat, generateIdFromHashes, getNeighbors, hashBool, hashDefaultMarkerIcon, hashGeoPoint, hashNullable, hashNum, hashObj, hashStr, hexCellToIdPrefix, hexCoordToString, ingestMarkers, interpolate$1 as interpolate, interpolateAtMeridianGeodesic, interpolateAtMeridianLinear, interpolate as interpolateWGS84, isEmptyCameraRestriction, isNativeMapExtensionCapable, longHashCode, mapViewStateInternal, markerIconHashCode, normalizeLngDegrees, resolveAttributionRules, resolveCameraRestriction, resolveHoles, resolveMapUISettings, resolveRasterAttributions, segmentIntersectsRegion, splitByMeridian, splitRingByMeridian, toDegrees, toInt, toRadians, unionHoleRings, unionHoles, unionHolesInPlace, withRasterHeaderTransform, wrapClickedPoint };
