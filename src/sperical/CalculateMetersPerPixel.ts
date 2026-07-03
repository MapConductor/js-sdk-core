import { Earth } from "../projection/Earth";
import { toRadians } from "./utils";

export function calculateMetersPerPixel({
    latitude,
    zoom,
    tileSize = 256.0,
}: {
    latitude: number;
    zoom: number;
    tileSize?: number;
}): number {
    const metersPerPixelAtEquator = Earth.CIRCUMFERENCE_METERS / tileSize;
    const metersPerPixelAtZoom = metersPerPixelAtEquator / Math.pow(2.0, zoom);
    const latitudeRadians = toRadians(Math.abs(latitude));
    const latitudeAdjustment = Math.cos(latitudeRadians);

    return metersPerPixelAtZoom * latitudeAdjustment;
}

export function meterToPixel({
    meter,
    latitude,
    zoom,
    tileSize = 256.0,
}: {
    meter: number;
    latitude: number;
    zoom: number;
    tileSize?: number;
}): number {
    const earthCircumference = 2 * Math.PI * Earth.RADIUS_METERS;
    const metersPerPixel = Math.cos(toRadians(latitude)) * earthCircumference / (tileSize * Math.pow(2.0, zoom));
    return meter / metersPerPixel;
}
