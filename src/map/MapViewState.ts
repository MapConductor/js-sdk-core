import type { GeoPoint } from '../features/GeoPoint';
import type { GeoRectBounds } from '../features/GeoRectBounds';
import { MapUISettings, resolveMapUISettings } from '../settings/MapUISettings';
import type { MapCameraPosition } from '../types/MapCamera';
import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';
import type { MapDesignTypeInterface } from './MapDesignTypeInterface';
import type { MapViewHolder } from './MapViewHolder';
import { MutableMapServiceRegistry } from './MapServiceRegistry';

export interface MapViewStateInterface<ActualMapDesignType extends MapDesignTypeInterface<unknown>> {
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

  /**
   * Called by the provider's own view component so it hears about later
   * `uiSettings` assignments. A plain field write cannot re-render a component
   * that does not own the state, so the flags are pushed instead of polled.
   */
  setUISettingsChangeListener(listener: ((settings: MapUISettings) => void) | null): void;

  moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  moveCameraTo(position: GeoPoint, durationMillis?: number): void;

  // On the state (like Android/iOS), delegating internally to the controller —
  // the same pattern as moveCameraTo.
  fitBounds(bounds: GeoRectBounds, padding?: number): void;

  getMapViewHolder(): MapViewHolder<unknown, unknown> | null;

  // Called by the provider's own view component once its controller is ready
  // (and with null on unmount) — the shared attach point every MapConductor
  // React component (LeafletMapView, GoogleMapView, ...) already uses internally.
  setController(controller: MapViewControllerInterface | null): void;

  // Called by the provider's own view component on every camera move/start/end.
  updateCameraPosition(camera: MapCameraPosition): void;

  setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void;
}

export abstract class MapViewState<ActualMapDesignType extends MapDesignTypeInterface<unknown>>
  implements MapViewStateInterface<ActualMapDesignType>
{
  // Equivalent of `private val tag = this.javaClass.name` in Kotlin.
  // Used for debug logging to identify the concrete subclass.
  protected readonly tag: string = this.constructor.name;

  abstract readonly id: string;
  abstract readonly cameraPosition: MapCameraPosition;
  abstract mapDesignType: ActualMapDesignType;

  /** @see MapViewStateInterface.serviceRegistry */
  readonly serviceRegistry: MutableMapServiceRegistry = new MutableMapServiceRegistry();

  // Concrete for every provider: the view subscribes and pushes the flags down
  // to its map engine, so no subclass has to reimplement it.
  private _uiSettings: MapUISettings = { ...MapUISettings.Default };
  private _uiSettingsChangeListener: ((settings: MapUISettings) => void) | null = null;

  get uiSettings(): MapUISettings {
    return this._uiSettings;
  }

  set uiSettings(value: MapUISettings) {
    this._uiSettings = resolveMapUISettings(value);
    this._uiSettingsChangeListener?.(this._uiSettings);
  }

  setUISettingsChangeListener(listener: ((settings: MapUISettings) => void) | null): void {
    this._uiSettingsChangeListener = listener;
  }

  abstract moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  abstract moveCameraTo(position: GeoPoint, durationMillis?: number): void;

  abstract fitBounds(bounds: GeoRectBounds, padding?: number): void;

  abstract getMapViewHolder(): MapViewHolder<unknown, unknown> | null;

  abstract setController(controller: MapViewControllerInterface | null): void;

  abstract updateCameraPosition(camera: MapCameraPosition): void;

  abstract setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void;
}
