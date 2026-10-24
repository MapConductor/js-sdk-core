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

/**
 * 投影が定義される緯度の端。
 *
 * Web Mercator は極で発散するので、正方形のワールドに収まる範囲で切る。
 * 世界中のタイルサーバが使っている値で、ここが `MAX_EXTENT` と一致する緯度。
 */
export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;

class WebMercatorClass implements Projection {
    /**
     * 緯度経度 -> EPSG:3857 メートル。
     *
     * 入力は投影前に wrap とクランプを通す。通さないと `latitude = 90` で
     * `Math.tan()` が発散し、呼び出し側に無限大が渡る。実測では web / android の
     * 旧実装が `+90` で 238107693（有限のゴミ）を、`-90` で `-Infinity` を
     * 返していた -- 同じ式が符号で違う壊れ方をしていた。ios-sdk は最初から
     * クランプしていたので、そちらに合わせてある。
     */
    project(position: GeoPointInterface): Offset {
        const wrapped = createGeoPoint({
            latitude: position.latitude,
            longitude: position.longitude,
            altitude: null,
        }).wrap();
        const latitude = Math.min(
            Math.max(wrapped.latitude, -WEB_MERCATOR_MAX_LATITUDE),
            WEB_MERCATOR_MAX_LATITUDE,
        );
        const x = wrapped.longitude * WEB_MERCATOR_MAX_EXTENT_METERS / 180
        const y = Math.log(Math.tan((90 + latitude) * Math.PI / 360)) * WEB_MERCATOR_MAX_EXTENT_METERS / Math.PI;
        return createOffset({
            x,
            y,
        });
    }

    /** EPSG:3857 メートル -> 緯度経度。結果は wrap して返す。 */
    unproject(point: Offset): GeoPoint {
        const longitude = point.x * 180 / WEB_MERCATOR_MAX_EXTENT_METERS
        const latitude = 180 / Math.PI * (2 * Math.atan(Math.exp(point.y * Math.PI / WEB_MERCATOR_MAX_EXTENT_METERS)) - Math.PI / 2);
        return createGeoPoint({
            latitude,
            longitude,
            altitude: null,
        }).wrap();
    }
}

export const WebMercator = new WebMercatorClass();
