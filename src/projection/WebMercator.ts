import { GeoPoint, GeoPointInterface, createGeoPoint } from "../features";
import { createOffset, Offset } from "../types"
import { Earth } from "./Earth"
import { Projection } from "./Projection"

/**
 * Maximum extent of the Web Mercator projection: half the equatorial
 * circumference (πa ≈ 20037508.34 m). Projected x/y values fall within
 * ±this value.
 */
export const WEB_MERCATOR_MAX_EXTENT_METERS = Math.PI * Earth.RADIUS_METERS;

class WebMercatorClass implements Projection {
    project(position: GeoPointInterface): Offset {
        const x = position.longitude * WEB_MERCATOR_MAX_EXTENT_METERS / 180
        const y = Math.log(Math.tan((90 + position.latitude) * Math.PI / 360)) * WEB_MERCATOR_MAX_EXTENT_METERS / Math.PI;
        return createOffset({
            x,
            y,
        });
    }

    unproject(point: Offset): GeoPoint {
        const longitude = point.x * 180 / WEB_MERCATOR_MAX_EXTENT_METERS
        const latitude = 180 / Math.PI * (2 * Math.atan(Math.exp(point.y * Math.PI / WEB_MERCATOR_MAX_EXTENT_METERS)) - Math.PI / 2);
        return createGeoPoint({
            latitude,
            longitude,
            altitude: null,
        });
    }
}

export const WebMercator = new WebMercatorClass();
