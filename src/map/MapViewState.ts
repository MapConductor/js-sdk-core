import type { GeoPoint } from '../features/GeoPoint';
import type { MapCameraPosition } from '../types/MapCamera';
import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';
import type { MapDesignTypeInterface } from './MapDesignTypeInterface';
import type { MapViewHolder } from './MapViewHolder';

export interface MapViewStateInterface<ActualMapDesignType extends MapDesignTypeInterface<unknown>> {
  readonly id: string;
  readonly cameraPosition: MapCameraPosition;
  mapDesignType: ActualMapDesignType;

  moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  moveCameraTo(position: GeoPoint, durationMillis?: number): void;

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

  abstract moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  abstract moveCameraTo(position: GeoPoint, durationMillis?: number): void;

  abstract getMapViewHolder(): MapViewHolder<unknown, unknown> | null;

  abstract setController(controller: MapViewControllerInterface | null): void;

  abstract updateCameraPosition(camera: MapCameraPosition): void;

  abstract setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void;
}
