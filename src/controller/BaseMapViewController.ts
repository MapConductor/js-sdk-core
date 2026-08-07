import { createGeoPoint, type GeoPoint } from '../features/GeoPoint';
import { isEmptyCameraRestriction, type CameraRestriction } from '../map/CameraRestriction';
import type { OnCameraMoveHandler, OnMapEventHandler } from '../map/MapViewBase';
import type { MapCameraPosition } from '../types/MapCamera';
import type { OverlayControllerLike } from './OverlayController';
import type { OnMapInitializedHandler } from './MapViewControllerInterface';

// 統一ズーム（Google 準拠）での許容誤差。これ未満の差では補正しない。
const ZOOM_EPS = 1e-3;

// 緯度経度（度）での許容誤差。
const COORD_EPS = 1e-7;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Abstract base class implementing the listener-management contract of MapViewControllerInterface.
 * Concrete SDK controllers extend this and call notify*() methods when native events fire.
 *
 * Mirrors Android BaseMapViewController / iOS MapViewController (base methods).
 */
export abstract class BaseMapViewController {
  protected cameraMoveStartCallback: OnCameraMoveHandler | null = null;
  protected cameraMoveCallback: OnCameraMoveHandler | null = null;
  protected cameraMoveEndCallback: OnCameraMoveHandler | null = null;
  protected mapClickCallback: OnMapEventHandler | null = null;
  protected mapLongClickCallback: OnMapEventHandler | null = null;
  protected mapInitializedCallback: OnMapInitializedHandler | null = null;
  private mapInitialized = false;
  private mapInitializedCallbackDelivered = false;

  private readonly overlayControllers: OverlayControllerLike[] = [];

  /**
   * ネイティブ SDK に直接のカメラ範囲制限 API を持たないプロバイダ（HERE/ArcGIS/MapKit/Cesium）が
   * クランプ方式で使う制限設定。ネイティブ API を持つプロバイダ（Mapbox/MapLibre/MapTiler/
   * TomTom/Google/Leaflet/OpenLayers/Azure Maps）は `setCameraRestriction` をオーバーライドして
   * 直接適用するため、この値は使わない。
   */
  private cameraRestriction: CameraRestriction | null = null;

  setCameraRestriction(restriction: CameraRestriction | null): void {
    this.cameraRestriction = isEmptyCameraRestriction(restriction) ? null : restriction;
  }

  protected hasCameraRestriction(): boolean {
    return this.cameraRestriction != null;
  }

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
  protected cameraRestrictionCorrection(current: MapCameraPosition): MapCameraPosition | null {
    const restriction = this.cameraRestriction;
    if (restriction == null) return null;

    let lat = current.position.latitude;
    let lng = current.position.longitude;
    let zoom = current.zoom;
    let changed = false;

    const { minZoom, maxZoom } = restriction;
    if (minZoom != null && zoom < minZoom - ZOOM_EPS) {
      zoom = minZoom;
      changed = true;
    }
    if (maxZoom != null && zoom > maxZoom + ZOOM_EPS) {
      zoom = maxZoom;
      changed = true;
    }

    const sw = restriction.bounds?.southWest ?? null;
    const ne = restriction.bounds?.northEast ?? null;
    if (sw != null && ne != null) {
      const south = Math.min(sw.latitude, ne.latitude);
      const north = Math.max(sw.latitude, ne.latitude);
      const west = Math.min(sw.longitude, ne.longitude);
      const east = Math.max(sw.longitude, ne.longitude);
      const clampedLat = clamp(lat, south, north);
      const clampedLng = clamp(lng, west, east);
      if (Math.abs(clampedLat - lat) > COORD_EPS) {
        lat = clampedLat;
        changed = true;
      }
      if (Math.abs(clampedLng - lng) > COORD_EPS) {
        lng = clampedLng;
        changed = true;
      }
    }

    if (!changed) return null;
    return current.copy({ position: createGeoPoint({ latitude: lat, longitude: lng }), zoom });
  }

  setCameraMoveStartListener(listener: OnCameraMoveHandler | null): void {
    this.cameraMoveStartCallback = listener;
  }

  setCameraMoveListener(listener: OnCameraMoveHandler | null): void {
    this.cameraMoveCallback = listener;
  }

  setCameraMoveEndListener(listener: OnCameraMoveHandler | null): void {
    this.cameraMoveEndCallback = listener;
  }

  setMapClickListener(listener: OnMapEventHandler | null): void {
    this.mapClickCallback = listener;
  }

  setMapLongClickListener(listener: OnMapEventHandler | null): void {
    this.mapLongClickCallback = listener;
  }

  setMapInitializedListener(listener: OnMapInitializedHandler | null): void {
    this.mapInitializedCallback = listener;
    this.deliverMapInitializedCallbackIfReady();
  }

  /**
   * オーバーレイコントローラを登録する。
   *
   * 登録したコントローラには `notifyMapCameraPosition` からカメラ変更が伝播し、
   * `destroy()` で一括破棄される。android-sdk の
   * `BaseMapViewController.registerOverlayController` に対応する。
   */
  registerOverlayController(controller: OverlayControllerLike): void {
    if (this.overlayControllers.includes(controller)) return;
    this.overlayControllers.push(controller);
  }

  /** 登録を解除する。拡張コンポーネントのアンマウント時に呼ぶ。 */
  unregisterOverlayController(controller: OverlayControllerLike): void {
    const index = this.overlayControllers.indexOf(controller);
    if (index >= 0) this.overlayControllers.splice(index, 1);
  }

  protected notifyCameraMoveStart(camera: MapCameraPosition): void {
    this.cameraMoveStartCallback?.(camera);
  }

  protected notifyCameraMove(camera: MapCameraPosition): void {
    this.cameraMoveCallback?.(camera);
  }

  protected notifyCameraMoveEnd(camera: MapCameraPosition): void {
    this.applyCameraRestrictionOnIdle(camera);
    // 登録済みオーバーレイコントローラへ伝播してから利用者コールバックを呼ぶ。
    // 拡張機能（marker-clustering 等）はこの経路でカメラ変更を受け取るので、
    // 単一スロットの cameraMoveEndCallback を奪い合う必要が無い。
    for (const controller of this.overlayControllers) {
      void controller.onCameraChanged?.(camera);
    }
    this.cameraMoveEndCallback?.(camera);
  }

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
  protected applyCameraRestrictionOnIdle(camera: MapCameraPosition): boolean {
    const corrected = this.cameraRestrictionCorrection(camera);
    if (corrected == null) return false;
    // moveCamera は MapViewControllerInterface 側のメンバで、この基底クラスには無い。
    // 実装クラスは必ず持っているので構造的に呼ぶ。
    const self = this as unknown as { moveCamera?(position: MapCameraPosition): unknown };
    void self.moveCamera?.(corrected);
    return true;
  }

  protected notifyMapClick(point: GeoPoint): void {
    this.mapClickCallback?.(point);
  }

  protected notifyMapLongClick(point: GeoPoint): void {
    this.mapLongClickCallback?.(point);
  }

  /**
   * マップ初期化を記録し、リスナーが揃った時点で1回だけ配送する。
   *
   * プロバイダのコントローラは、React 側の effect がリスナーを張り終える前に初期化を
   * 完了させることがある（effect はマウント後に走るため）。sticky にしておくことで、
   * その隙間で初期化完了が取りこぼされるのを防ぐ。
   * android-sdk の `notifyMapInitialized` / `deliverMapInitializedCallbackIfReady` の移植。
   */
  protected notifyMapInitialized(): void {
    this.mapInitialized = true;
    this.deliverMapInitializedCallbackIfReady();
  }

  private deliverMapInitializedCallbackIfReady(): void {
    if (!this.mapInitialized || this.mapInitializedCallbackDelivered) return;
    const callback = this.mapInitializedCallback;
    if (callback == null) return;
    this.mapInitializedCallbackDelivered = true;
    callback();
  }

  /**
   * カメラ変更を登録済みオーバーレイコントローラへ伝播し、続けて利用者コールバックを呼ぶ。
   *
   * android-sdk の `notifyMapCameraPosition` に対応する。プロバイダが個別に
   * `Promise.all([...onCameraChanged])` を書く必要がなくなり、拡張機能
   * （marker-clustering 等）も自前でリスナースロットを奪わずにカメラ変更を受け取れる。
   */
  protected async notifyMapCameraPosition(camera: MapCameraPosition): Promise<void> {
    for (const controller of this.overlayControllers) {
      await controller.onCameraChanged?.(camera);
    }
    this.cameraMoveCallback?.(camera);
  }

  destroy(): void {
    for (const controller of this.overlayControllers) {
      controller.destroy?.();
    }
    this.overlayControllers.length = 0;
  }
}
