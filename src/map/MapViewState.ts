import type { GeoPoint } from '../features/GeoPoint';
import type { GeoRectBounds } from '../features/GeoRectBounds';
import { DefaultMapUISettings, resolveMapUISettings, type MapUISettings } from '../settings/MapUISettings';
import type { MapCameraPosition } from '../types/MapCamera';
import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';
import type { MapDesignTypeInterface } from './MapDesignTypeInterface';
import type { MapViewHolder } from './MapViewHolder';

export interface MapViewStateInterface<ActualMapDesignType extends MapDesignTypeInterface<unknown>> {
  readonly id: string;
  readonly cameraPosition: MapCameraPosition;
  mapDesignType: ActualMapDesignType;

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

  // Concrete for every provider: the view subscribes and pushes the flags down
  // to its map engine, so no subclass has to reimplement it.
  private _uiSettings: MapUISettings = { ...DefaultMapUISettings };
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
