import type { CameraRestriction } from './CameraRestriction';
import type { MapViewStyle } from './MapViewStyle';
import type { GeoPoint } from '../features/GeoPoint';
import type { MapCameraPosition } from '../types/MapCamera';
import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';
import type { MapConfig } from '../provider/MapProvider';
import type { MapDesignTypeInterface } from './MapDesignTypeInterface';
import type { MapViewHolder } from './MapViewHolder';
import type { MapViewStateInterface } from './MapViewState';

// Handler type aliases — mirrors Android typealias declarations in MapViewBase.kt
export type OnMapLoadedHandler<TState> = (state: TState) => void;
export type OnMapEventHandler = (point: GeoPoint) => void;
export type OnCameraMoveHandler = (camera: MapCameraPosition) => void;

/**
 * Common props that every map-view component must accept.
 * Extend this interface in SDK-specific packages to add platform-specific props
 * (e.g. apiKey for Google Maps, style URL for MapLibre).
 */
export interface MapViewBaseProps<TState extends MapViewStateInterface<MapDesignTypeInterface<unknown>>> {
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
  /**
   * 地図の見た目。デザイン名を選ぶ代わりにアプリが直接述べるときに渡す。
   *
   * ベクタースタイルは**ベースマップそのもの**なので、重ねるのではなく
   * 「これが地図だ」と言う。`@mapconductor/vectorstyle` が作る。下で何が
   * 起きるかはバックエンド次第で、アプリは知らなくてよい。
   *
   * **android-sdk と ios-sdk ではこの引数名は `style`。** JS だけ違うのは
   * `style` が React/React Native では要素自身の見た目を指す名前として
   * 予約同然だから。RN の `MapViewBaseProps` は実際に `style` を
   * コンテナのスタイルとして使っており、そこを奪うと React を書く人全員が
   * 踏む。web と RN で名前を割るほうが悪いので、JS 側は両方 `mapStyle`。
   */
  mapStyle?: MapViewStyle | null;
  /** スタイルが言ってきたこと。渡さなければ console に出る。 */
  onStyleDiagnostics?: (diagnostics: readonly string[]) => void;
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
export abstract class MapViewBase<
  TState extends MapViewStateInterface<MapDesignTypeInterface<unknown>>,
  THolder extends MapViewHolder<unknown, unknown>,
  TController extends MapViewControllerInterface,
> {
  /** Load the underlying map SDK. Return false to abort initialization. */
  protected abstract sdkInitialize(): Promise<boolean>;

  /** Build the SDK-specific config from the view state (camera position, design type, etc.). */
  protected abstract buildConfig(state: TState, container: HTMLElement): MapConfig;

  /** Create a holder that wraps the native map view instance. */
  protected abstract createHolder(container: HTMLElement): Promise<THolder>;

  /** Create the controller that exposes the MapConductor API. */
  protected abstract createController(holder: THolder): Promise<TController>;
}
