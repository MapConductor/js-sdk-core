import { GeoPoint, GeoPointInterface, createGeoPoint, fromGeoPoint } from '../features/GeoPoint';
import { VisibleRegion } from './VisibleRegion';

/**
 * Padding applied to the map edges.
 */
export interface MapPaddings {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export namespace MapPaddings {
  export const Zeros: MapPaddings = {
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  };

  export const from = (paddings: MapPaddings): MapPaddings => ({
    top: paddings.top,
    left: paddings.left,
    bottom: paddings.bottom,
    right: paddings.right,
  });
}

export type MapPaddingsInterface = MapPaddings;

export interface MapCameraPositionCopyParams {
  position?: GeoPointInterface | null;
  center?: GeoPointInterface | null;
  zoom?: number | null;
  bearing?: number | null;
  tilt?: number | null;
  visibleRegion?: VisibleRegion | null;
  paddings?: MapPaddings | null;
}

/**
 * Represents the camera position and orientation for the map view.
 */
export interface MapCameraPosition {
  /** Kotlin-compatible camera target. */
  position: GeoPoint;
  /** Backward-compatible alias for position. */
  center: GeoPoint;
  /** Zoom level (typically 0-22, where higher is more zoomed in). */
  zoom: number;
  /** Bearing/rotation in degrees (0-360, where 0 is north). */
  bearing: number;
  /** Kotlin-compatible tilt in degrees. */
  tilt: number;
  visibleRegion: VisibleRegion | null;
  paddings: MapPaddings | null;
  equals(other: MapCameraPosition | null, tolerance?: number): boolean;
  copy(partial?: MapCameraPositionCopyParams): MapCameraPosition;
}

/**
 * Options for camera movement.
 */
export interface CameraOptions {
  /** Duration of animation in milliseconds */
  duration?: number;
  /** Easing function for animation */
  easing?: (t: number) => number;
  /** Padding around the map in pixels */
  paddings?: MapPaddings;
  /** Backward-compatible alias used by early provider implementations */
  padding?: number | MapPaddings;
}

const numberEquals = (a: number, b: number, tolerance: number) => Math.abs(a - b) < tolerance;

const pointEquals = (a: GeoPointInterface, b: GeoPointInterface, tolerance: number) => (
  numberEquals(a.latitude, b.latitude, tolerance) &&
  numberEquals(a.longitude, b.longitude, tolerance) &&
  numberEquals(a.altitude ?? 0, b.altitude ?? 0, tolerance)
);

export type MapCameraPositionInterface = {
  position: GeoPointInterface,
  zoom?: number,
  bearing?: number,
  tilt?: number,
  paddings?: MapPaddings | null,
  visibleRegion?: VisibleRegion | null,
};

/**
 * Creates a default camera position.
 */
export function createMapCameraPosition({
  position,
  zoom = 0,
  bearing = 0,
  tilt = 0,
  paddings = MapPaddings.Zeros,
  visibleRegion = null,
}: MapCameraPositionInterface): MapCameraPosition {
  const normalizedPosition = fromGeoPoint(position);
  const normalizedPaddings = paddings == null ? null : MapPaddings.from(paddings);

  return {
    get position() {
      return normalizedPosition;
    },
    get center() {
      return normalizedPosition;
    },
    get zoom() {
      return zoom
    },
    get bearing() {
      return bearing
    },
    get tilt() {
      return tilt;
    },
    get visibleRegion() {
      return visibleRegion;
    },
    paddings: normalizedPaddings,
    equals(other: MapCameraPosition | null, tolerance: number = 1e-2): boolean {
      if (!other) return false;
      return (
        pointEquals(normalizedPosition, other.position ?? other.center, tolerance) &&
        numberEquals(zoom, other.zoom, tolerance) &&
        numberEquals(bearing, other.bearing, tolerance) &&
        numberEquals(tilt, other.tilt, tolerance)
      );
    },
    copy(partial: MapCameraPositionCopyParams = {}): MapCameraPosition {
      return createMapCameraPosition({
        position: partial.position ?? partial.center ?? normalizedPosition,
        zoom: partial.zoom ?? zoom,
        bearing: partial.bearing ?? bearing,
        tilt: partial.tilt ?? tilt,
        paddings: partial.paddings ?? normalizedPaddings,
        visibleRegion: partial.visibleRegion ?? visibleRegion,
      });
    },
  };
}

export namespace MapCameraPosition {
  export const Default = createMapCameraPosition({
    position: createGeoPoint({
      latitude: 0,
      longitude: 0,
      altitude: 0,
    }),
    zoom: 0,
    tilt: 0,
    bearing: 0,
  });

  export function from(other: MapCameraPositionInterface): MapCameraPosition {
    return createMapCameraPosition({
      position: other.position,
      zoom: other.zoom,
      bearing: other.bearing,
      tilt: other.tilt,
      paddings: other.paddings,
      visibleRegion: other.visibleRegion,
    });
  }
}
