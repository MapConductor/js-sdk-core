import { GeoPoint, GeoPointInterface } from "../features";
import { MapCoordinateSystem } from "../projection/MapCoordinateSystem";
import { WebMercator } from "../projection/WebMercator";
import { Offset } from "../types";

export type ScreenOffsetResult = Offset | null | Promise<Offset | null>;

export interface MapViewHolder<ActualMapView, ActualMap> {
    mapView: ActualMapView;
    map: ActualMap;

    toScreenOffset(position: GeoPointInterface): ScreenOffsetResult;

    fromScreenOffset(offset: Offset): Promise<GeoPoint | null>;

    fromScreenOffsetSync(offset: Offset): GeoPoint | null;

    /**
     * The coordinate system the map engine is using now. Values from
     * {@link toProjectedPoint} are in it.
     */
    readonly coordinateSystem: MapCoordinateSystem;

    /**
     * Geographic point -> projected point in {@link coordinateSystem}. **Not
     * screen coordinates.** Null when it cannot be converted (outside the
     * projection's domain, for instance).
     */
    toProjectedPoint(position: GeoPointInterface): Offset | null;

    /** Projected point in {@link coordinateSystem} -> geographic point. Null when it cannot be converted. */
    fromProjectedPoint(point: Offset): GeoPoint | null;
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

    /**
     * Defaults to EPSG:3857 meters, which fits engines that only have Mercator
     * and engines showing a globe. Only engines with a coordinate system per
     * map (ArcGIS and the like) override these three.
     */
    get coordinateSystem(): MapCoordinateSystem {
        return MapCoordinateSystem.WebMercator;
    }

    toProjectedPoint(position: GeoPointInterface): Offset | null {
        return WebMercator.project(position);
    }

    fromProjectedPoint(point: Offset): GeoPoint | null {
        return WebMercator.unproject(point);
    }
}
