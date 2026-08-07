/**
 * 地図面を描くときの投影法。
 *
 * android-sdk の `enum class MapProjection { Mercator, Globe }` /
 * ios-sdk の `enum MapProjection { case mercator, globe }` と同じ契約。
 * 値は Android の case 名に合わせてある。
 *
 * 対応プロバイダは web では mapbox / maplibre / maptiler の 3 つ。
 * HERE は JS SDK v3 が globe を持たないため mercator 固定（HereMapView2D.web.tsx の
 * コメント参照）。他は投影法が固定のため、このプロパティを受け取らない。
 */
export enum MapProjection {
    Mercator = "Mercator",
    Globe = "Globe",
}
