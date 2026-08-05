import type { GeoRectBounds } from '../features/GeoRectBounds';
import type { MapViewHolder } from '../map/MapViewHolder';
import type { OnCameraMoveHandler, OnMapEventHandler } from '../map/MapViewBase';
import type { MapUISettings } from '../settings/MapUISettings';
import type { CameraOptions, MapCameraPosition } from '../types/MapCamera';

// Matches Android: typealias OnMapInitializedHandler = () -> Unit
export type OnMapInitializedHandler = () => void;

/**
 * Core controller interface that all map SDK modules must implement.
 * Mirrors Android MapViewControllerInterface / iOS MapViewControllerProtocol.
 */
export interface MapViewControllerInterface {
  readonly holder: MapViewHolder<unknown, unknown>;

  clearOverlays(): Promise<void>;

  setCameraMoveStartListener(listener: OnCameraMoveHandler | null): void;
  setCameraMoveListener(listener: OnCameraMoveHandler | null): void;
  setCameraMoveEndListener(listener: OnCameraMoveHandler | null): void;
  setMapClickListener(listener: OnMapEventHandler | null): void;
  setMapLongClickListener(listener: OnMapEventHandler | null): void;
  setMapInitializedListener(listener: OnMapInitializedHandler | null): void;

  moveCamera(position: MapCameraPosition): Promise<boolean>;
  animateCamera(position: MapCameraPosition, options?: CameraOptions): Promise<boolean>;

  /**
   * Applies the gesture flags to the underlying map engine.
   *
   * Optional the same way Android's `applyUISettings` has an empty default body:
   * a provider that has not been wired up yet simply leaves the map as it is.
   */
  applyUISettings?(settings: MapUISettings): void;

  // Web-specific (not in Android/iOS interface, but universally needed on web)
  fitBounds(bounds: GeoRectBounds, options?: CameraOptions): Promise<boolean>;
  getCameraPosition(): MapCameraPosition | null;
  getBounds(): GeoRectBounds | null;
  destroy(): void;
}
