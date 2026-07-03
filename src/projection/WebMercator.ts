import { GeoPoint, GeoPointInterface, createGeoPoint } from "../features";
import { createOffset, Offset } from "../types"
import { Projection } from "./Projection"

class WebMercatorClass implements Projection {
    project(position: GeoPointInterface): Offset {
        const x = position.longitude * 20037508.34 / 180
        const y = Math.log(Math.tan((90 + position.latitude) * Math.PI / 360)) * 20037508.34 / Math.PI;
        return createOffset({
            x,
            y,
        });
    }

    unproject(point: Offset): GeoPoint {
        const longitude = point.x * 180 / 20037508.34
        const latitude = 180 / Math.PI * (2 * Math.atan(Math.exp(point.y * Math.PI / 20037508.34)) - Math.PI / 2);
        return createGeoPoint({
            latitude,
            longitude,
            altitude: null,
        });
    }
}

export const WebMercator = new WebMercatorClass();
