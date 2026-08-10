import { createRandomId } from '../features/RandomId';
import type { GeoPoint } from '../features/GeoPoint';
import type { GeoRectBounds } from '../features/GeoRectBounds';
import { MapUISettings, resolveMapUISettings } from '../settings/MapUISettings';
import { MapCameraPosition as MapCameraPositionNS, type MapCameraPosition } from '../types/MapCamera';
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

/** {@link MapViewState} のコンストラクタ引数。 */
export interface MapViewStateOptions {
  /** state の識別子。省略するとランダム。 */
  id?: string;
  /**
   * コントローラが繋がるまでの間、保持しておくカメラ。
   * {@link MapViewState.attachController} の時点でこの位置へ移動する。
   */
  cameraPosition?: MapCameraPosition;
  /** 初期のジェスチャ設定。 */
  uiSettings?: Partial<MapUISettings>;
  /**
   * {@link MapViewState.moveCameraTo} で、コントローラへ委譲したあとに要求された
   * カメラを {@link MapViewState.cameraPosition} へ反映するか。
   *
   * **web は既定が `true`。** android / iOS は `false`（地図が返してきた実際の値だけを
   * 入れる）だが、web のエンジンはカメラ移動イベントが非同期で、しかも React には
   * Compose の再コンポーズや SwiftUI の `@Published` に当たる push が無い。
   * 要求直後に `cameraPosition` を読むと古い値が返るため、要求値をそのまま保持する。
   * 全 web プロバイダが移行前からこの形だった。
   */
  optimisticCameraUpdate?: boolean;
}

/**
 * 全プロバイダ共通の state 実装。
 *
 * カメラの保持と、コントローラへの委譲（{@link moveCameraTo} / {@link fitBounds} /
 * {@link getMapViewHolder}）はどのプロバイダでも同じなのでここに置く。
 * プロバイダ固有なのは `mapDesignType` の型と、`getMapViewHolder()` の戻り型を
 * 絞るオーバーライドだけ。android-sdk / ios-sdk の `MapViewState` と同じ形。
 */
export abstract class MapViewState<ActualMapDesignType extends MapDesignTypeInterface<unknown>>
  implements MapViewStateInterface<ActualMapDesignType>, MapViewStateInternal
{
  // Equivalent of `private val tag = this.javaClass.name` in Kotlin.
  // Used for debug logging to identify the concrete subclass.
  protected readonly tag: string = this.constructor.name;

  readonly id: string;
  abstract mapDesignType: ActualMapDesignType;

  /** @see MapViewStateInterface.serviceRegistry */
  readonly serviceRegistry: MutableMapServiceRegistry = new MutableMapServiceRegistry();

  private readonly optimisticCameraUpdate: boolean;
  private _cameraPosition: MapCameraPosition;
  private _cameraPositionChangeListener: ((camera: MapCameraPosition) => void) | null = null;

  /**
   * 接続済みのコントローラ。まだ地図が生成されていなければ null。
   *
   * 名前が `controller` でないのは、プロバイダが自分のコントローラ型で
   * `controller` フィールドを持てるようにするため。
   */
  protected attachedMapController: MapViewControllerInterface | null = null;

  // Concrete for every provider: the view subscribes and pushes the flags down
  // to its map engine, so no subclass has to reimplement it.
  private _uiSettings: MapUISettings = { ...MapUISettings.Default };
  private _uiSettingsChangeListener: ((settings: MapUISettings) => void) | null = null;

  constructor(options: MapViewStateOptions = {}) {
    this.id = options.id ?? createRandomId();
    this._cameraPosition = options.cameraPosition ?? MapCameraPositionNS.Default;
    this._uiSettings = resolveMapUISettings(options.uiSettings);
    this.optimisticCameraUpdate = options.optimisticCameraUpdate ?? true;
  }

  get cameraPosition(): MapCameraPosition {
    return this._cameraPosition;
  }

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

  moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  moveCameraTo(position: GeoPoint, durationMillis?: number): void;
  moveCameraTo(positionOrCamera: GeoPoint | MapCameraPosition, durationMillis?: number): void {
    const next =
      'zoom' in positionOrCamera
        ? this.resolveCameraPosition(positionOrCamera as MapCameraPosition)
        : this._cameraPosition.copy({ position: positionOrCamera as GeoPoint });

    const controller = this.attachedMapController;
    if (!controller) {
      // まだ地図が無い。接続時に attachController がこの位置へ移動する。
      this._cameraPosition = next;
      return;
    }

    if (!durationMillis || durationMillis === 0) {
      void controller.moveCamera(next);
    } else {
      void controller.animateCamera(next, durationMillis);
    }

    if (this.optimisticCameraUpdate) {
      this._cameraPosition = next;
      this._cameraPositionChangeListener?.(next);
    }
  }

  fitBounds(bounds: GeoRectBounds, padding: number = 0): void {
    void this.attachedMapController?.fitBounds(bounds, padding);
  }

  /**
   * 各プロバイダは戻り型を自分のホルダー型へ絞るオーバーライドを 1 つだけ置くこと。
   * アプリが `state.getMapViewHolder()?.map` でネイティブの地図を取れる形を保つため。
   */
  getMapViewHolder(): MapViewHolder<unknown, unknown> | null {
    return this.attachedMapController?.holder ?? null;
  }

  /**
   * コントローラを接続する。プロバイダのビューが `setController` から呼ぶ。
   *
   * @param moveToInitialCamera 接続時に、保持していたカメラ位置へ移動するか。
   *   既定は `true`。地図の生成直後にカメラを動かすと初期位置が上書きされてしまう
   *   プロバイダは `false` を渡す。
   */
  protected attachController(
    controller: MapViewControllerInterface | null,
    moveToInitialCamera: boolean = true,
  ): void {
    this.attachedMapController = controller;
    if (controller && moveToInitialCamera) {
      void controller.moveCamera(this._cameraPosition);
    }
  }

  /**
   * 地図から通知された現在のカメラを保持する（地図を動かさない）。
   *
   * カメラを**動かしたい**ときは {@link moveCameraTo} を使うこと。
   */
  protected setCameraPositionInternal(camera: MapCameraPosition): void {
    this._cameraPosition = camera;
    this._cameraPositionChangeListener?.(camera);
  }

  setController(controller: MapViewControllerInterface | null): void {
    this.attachController(controller);
  }

  updateCameraPosition(camera: MapCameraPosition): void {
    this.setCameraPositionInternal(camera);
  }

  setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void {
    this._cameraPositionChangeListener = listener;
  }

  /**
   * ズーム・ベアリング・チルトがすべて 0 の「未指定」カメラは、位置だけを差し替える。
   *
   * アプリが位置だけを渡してきたときに、いまの縮尺を保ったまま移動するための救済。
   * 全プロバイダが同じ判定をしていた（react-for-arcgis だけ抜けていたのでここで揃う）。
   */
  private resolveCameraPosition(target: MapCameraPosition): MapCameraPosition {
    const isUnspecified = target.zoom === 0 && target.bearing === 0 && target.tilt === 0;
    if (isUnspecified) return this._cameraPosition.copy({ position: target.position });
    return target;
  }
}
