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
  /**
   * Zoom level (typically 0-22, where higher is more zoomed in).
   *
   * Reads 0 when the camera was built without one; {@link isZoomSpecified}
   * tells the two apart.
   */
  zoom: number;
  /**
   * Map rotation in degrees (0-360, where 0 is north).
   *
   * Increasing it turns the map **clockwise**: at 90 the map has rotated 90
   * degrees to the right, so west is at the top of the screen. This is the
   * opposite sign from the "camera heading" used by most native SDKs — see
   * `CameraBearing` for the conversion.
   */
  bearing: number;
  /** Kotlin-compatible tilt in degrees. */
  tilt: number;
  visibleRegion: VisibleRegion | null;
  paddings: MapPaddings | null;
  /**
   * Whether `zoom` / `bearing` / `tilt` were given.
   *
   * Kept so an explicit 0 (zoom 0 is the whole world, bearing 0 is north up,
   * tilt 0 is straight down) is not mistaken for "not given".
   * `MapViewState.moveCameraTo` takes only the unset ones from the current
   * camera ({@link resolvedOnto}).
   */
  readonly isZoomSpecified: boolean;
  readonly isBearingSpecified: boolean;
  readonly isTiltSpecified: boolean;
  equals(other: MapCameraPosition | null, tolerance?: number): boolean;
  /** Keeps a property unset unless `partial` gives it. */
  copy(partial?: MapCameraPositionCopyParams): MapCameraPosition;
  /**
   * Returns this camera with the unset `zoom` / `bearing` / `tilt` filled in
   * from `current`. A property that was given is used as is, 0 included.
   */
  resolvedOnto(current: MapCameraPosition): MapCameraPosition;
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
  zoom: givenZoom,
  bearing: givenBearing,
  tilt: givenTilt,
  paddings = MapPaddings.Zeros,
  visibleRegion = null,
}: MapCameraPositionInterface): MapCameraPosition {
  const isZoomSpecified = givenZoom != null;
  const isBearingSpecified = givenBearing != null;
  const isTiltSpecified = givenTilt != null;
  const zoom = givenZoom ?? 0;
  const bearing = givenBearing ?? 0;
  const tilt = givenTilt ?? 0;
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
    isZoomSpecified,
    isBearingSpecified,
    isTiltSpecified,
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
        zoom: partial.zoom ?? givenZoom,
        bearing: partial.bearing ?? givenBearing,
        tilt: partial.tilt ?? givenTilt,
        paddings: partial.paddings ?? normalizedPaddings,
        visibleRegion: partial.visibleRegion ?? visibleRegion,
      });
    },
    resolvedOnto(current: MapCameraPosition): MapCameraPosition {
      if (isZoomSpecified && isBearingSpecified && isTiltSpecified) {
        return this;
      }
      return createMapCameraPosition({
        position: normalizedPosition,
        zoom: isZoomSpecified ? zoom : current.zoom,
        bearing: isBearingSpecified ? bearing : current.bearing,
        tilt: isTiltSpecified ? tilt : current.tilt,
        paddings: normalizedPaddings,
        visibleRegion,
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

  export function from(
    other: MapCameraPositionInterface | MapCameraPosition,
  ): MapCameraPosition {
    // A MapCameraPosition reads 0 for an unset property; keep it unset.
    const camera = other as Partial<MapCameraPosition>;
    return createMapCameraPosition({
      position: other.position,
      zoom: camera.isZoomSpecified === false ? undefined : other.zoom,
      bearing: camera.isBearingSpecified === false ? undefined : other.bearing,
      tilt: camera.isTiltSpecified === false ? undefined : other.tilt,
      paddings: other.paddings,
      visibleRegion: other.visibleRegion,
    });
  }
}
