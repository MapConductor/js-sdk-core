import type { GeoRectBounds } from '../features/GeoRectBounds';

/**
 * カメラの可動範囲を制限する設定。
 *
 * - `bounds` : カメラ（ビューポート）がこの矩形の外へ出られないように制限する。null で無制限。
 * - `minZoom` / `maxZoom` : ズームの下限・上限。値は統一ズーム（Google Maps 準拠, 0..22 相当）で
 *   指定し、各プロバイダが自身のズーム体系へ変換して適用する。null で無制限。
 *
 * android-sdk の `CameraRestriction`（core/map/CameraRestriction.kt）に対応する。
 *
 * 適用方式はプロバイダによって2通りある（android-sdk と同じ振り分け）:
 * - ネイティブの範囲制限 API を持つもの（Mapbox / MapLibre / MapTiler / TomTom / Google /
 *   Leaflet / OpenLayers / Azure Maps）: `setCameraRestriction` をオーバーライドして直接適用する。
 * - 持たないもの（HERE / ArcGIS / MapKit / Cesium）: カメラ停止時に
 *   `BaseMapViewController.cameraRestrictionCorrection()` で中心座標・ズームを矩形内へ
 *   クランプして再適用する。
 */
export interface CameraRestriction {
    bounds?: GeoRectBounds | null;
    minZoom?: number | null;
    maxZoom?: number | null;
}

/** 制限が実質的に無い（= 適用しても何も起きない）場合に true。 */
export function isEmptyCameraRestriction(restriction: CameraRestriction | null | undefined): boolean {
    if (restriction == null) return true;
    const boundsEmpty = restriction.bounds == null || restriction.bounds.isEmpty;
    return boundsEmpty && restriction.minZoom == null && restriction.maxZoom == null;
}

/** android-sdk の `CameraRestriction.None` に対応する。 */
export const NoCameraRestriction: CameraRestriction = {};

/**
 * `restrictBounds` / `minZoom` / `maxZoom` という個別 prop 形式を `CameraRestriction` に正規化する。
 *
 * react-for-* は歴史的に3つの独立した prop としてマップ生成時 config に渡していた。
 * 両方の形を受けられるようにして、既存利用側を壊さずに core へ集約するためのヘルパー。
 * 両方指定された場合は `cameraRestriction` を優先する。
 */
export function resolveCameraRestriction(params: {
    cameraRestriction?: CameraRestriction | null;
    restrictBounds?: GeoRectBounds | null;
    minZoom?: number | null;
    maxZoom?: number | null;
}): CameraRestriction | null {
    const resolved: CameraRestriction = params.cameraRestriction ?? {
        bounds: params.restrictBounds ?? null,
        minZoom: params.minZoom ?? null,
        maxZoom: params.maxZoom ?? null,
    };
    return isEmptyCameraRestriction(resolved) ? null : resolved;
}
