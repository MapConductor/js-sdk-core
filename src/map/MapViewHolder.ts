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

    /**
     * Default async wrapper over the synchronous path. Holders whose provider
     * only offers an asynchronous projection API override this.
     */
    async fromScreenOffset(offset: Offset): Promise<GeoPoint | null> {
        return this.fromScreenOffsetSync(offset);
    }

    fromScreenOffsetSync(_offset: Offset): GeoPoint | null {
        return null;
    }
}
