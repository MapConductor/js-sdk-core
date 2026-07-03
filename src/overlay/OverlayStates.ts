import { GeoPoint, GeoRectBounds } from '../features';
import { MarkerState } from '../marker';

export interface MarkerOptions extends Partial<Omit<MarkerState, 'fingerPrint'>> {
  position: GeoPoint;
  id?: string;
  // TS provider compatibility only; Kotlin MarkerState does not define title.
  title?: string;
  zIndex?: number;
  // TS provider compatibility only; Kotlin MarkerState does not define opacity.
  opacity?: number;
}

export interface CircleOptions {
  id?: string;
  center: GeoPoint;
  radius: number;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  clickable?: boolean;
  visible?: boolean;
  zIndex?: number;
}

export interface PolylineOptions {
  id?: string;
  path: GeoPoint[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  clickable?: boolean;
  visible?: boolean;
  zIndex?: number;
}

export interface PolygonOptions {
  id?: string;
  path: GeoPoint[];
  holes?: GeoPoint[][];
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  clickable?: boolean;
  visible?: boolean;
  zIndex?: number;
}

export interface GroundOverlayOptions {
  id?: string;
  bounds: GeoRectBounds;
  imageUrl: string;
  opacity?: number;
  clickable?: boolean;
  visible?: boolean;
  zIndex?: number;
}
