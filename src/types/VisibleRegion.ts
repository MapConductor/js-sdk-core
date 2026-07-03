import { GeoRectBounds, GeoPoint } from "../features";

export interface VisibleRegion {
    bounds: GeoRectBounds;
    nearLeft: GeoPoint | null;
    nearRight: GeoPoint | null;
    farLeft: GeoPoint | null;
    farRight: GeoPoint | null;
}
