import type { GeoRectBounds } from '../features/GeoRectBounds';
import type { MapViewHolder } from '../map/MapViewHolder';
import type { OnCameraMoveHandler, OnMapEventHandler } from '../map/MapViewBase';
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

  // Web-specific (not in Android/iOS interface, but universally needed on web)
  fitBounds(bounds: GeoRectBounds, options?: CameraOptions): Promise<boolean>;
  getCameraPosition(): MapCameraPosition | null;
  getBounds(): GeoRectBounds | null;
  destroy(): void;
}
