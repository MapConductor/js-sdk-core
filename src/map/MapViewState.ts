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

  moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  moveCameraTo(position: GeoPoint, durationMillis?: number): void;

  // On the state (like Android/iOS), delegating internally to the controller —
  // the same pattern as moveCameraTo.
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
export interface MapViewStateInternal {
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
export function mapViewStateInternal(
  state: MapViewStateInterface<MapDesignTypeInterface<unknown>>,
): MapViewStateInternal {
  return state as unknown as MapViewStateInternal;
}

export abstract class MapViewState<ActualMapDesignType extends MapDesignTypeInterface<unknown>>
  implements MapViewStateInterface<ActualMapDesignType>, MapViewStateInternal
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
