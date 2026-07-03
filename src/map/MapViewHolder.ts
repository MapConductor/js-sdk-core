import { GeoPoint, GeoPointInterface } from "../features";
import { Offset } from "../types";

export type ScreenOffsetResult = Offset | null | Promise<Offset | null>;

export interface MapViewHolder<ActualMapView, ActualMap> {
    mapView: ActualMapView;
    map: ActualMap;

    toScreenOffset(position: GeoPointInterface): ScreenOffsetResult;

    fromScreenOffset(offset: Offset): Promise<GeoPoint | null>;

    fromScreenOffsetSync(offset: Offset): GeoPoint | null;
}

export abstract class MapViewHolderBase<ActualMapView, ActualMap>
    implements MapViewHolder<ActualMapView, ActualMap> {
    abstract mapView: ActualMapView;
    abstract map: ActualMap;

    abstract toScreenOffset(position: GeoPointInterface): ScreenOffsetResult;

    abstract fromScreenOffset(offset: Offset): Promise<GeoPoint | null>;

    fromScreenOffsetSync(_offset: Offset): GeoPoint | null {
        return null;
    }
}
