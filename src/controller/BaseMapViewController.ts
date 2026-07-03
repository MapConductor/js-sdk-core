import type { GeoPoint } from '../features/GeoPoint';
import type { OnCameraMoveHandler, OnMapEventHandler } from '../map/MapViewBase';
import type { MapCameraPosition } from '../types/MapCamera';
import type { OnMapInitializedHandler } from './MapViewControllerInterface';

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
  }

  protected notifyCameraMoveStart(camera: MapCameraPosition): void {
    this.cameraMoveStartCallback?.(camera);
  }

  protected notifyCameraMove(camera: MapCameraPosition): void {
    this.cameraMoveCallback?.(camera);
  }

  protected notifyCameraMoveEnd(camera: MapCameraPosition): void {
    this.cameraMoveEndCallback?.(camera);
  }

  protected notifyMapClick(point: GeoPoint): void {
    this.mapClickCallback?.(point);
  }

  protected notifyMapLongClick(point: GeoPoint): void {
    this.mapLongClickCallback?.(point);
  }

  protected notifyMapInitialized(): void {
    this.mapInitializedCallback?.();
  }
}
