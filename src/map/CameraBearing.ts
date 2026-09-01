// `MapCameraPosition.bearing` とネイティブ SDK の回転値の変換。
//
// MapConductor の `bearing` は **「値を増やすと地図が時計回り（右）に回る」** 向きで
// 定義する。0 が北で、90 なら地図全体が右へ 90 度回り、画面の上には西が来る。
//
// ネイティブ SDK は大きく 2 系統に分かれる。
//
// - **heading 系**（Google Maps / MapLibre / Mapbox / HERE / Cesium / MapKit ほか）
// 「画面の上が指す方位を北から時計回りに測る」＝カメラの向き。値を増やすと地図は
// 反時計回りに回るので、MapConductor とは符号が反転する。{@link toNativeHeading}。
// - **rotation 系**（ArcGIS の `Viewpoint.rotation` / OpenLayers の `View.rotation`）
// 「北を時計回りに回す量」＝地図の回転角。MapConductor と同じ向きなので変換は
// 恒等になる。{@link toNativeRotation}。
//
// 符号をプロバイダ各所に散らすと必ずどこかが漏れるので、変換はここだけに置く。
//
// ここはドライバー実装点で、アプリ開発者向けの公開 API ではない（android の
// `@InternalMapConductorApi`、iOS の `@_spi(MapConductorDriver)` に対応）。
// 各関数の JSDoc に付けたタグで公開サーフェスから除外している。
//
// NOTE: このモジュールレベルのコメントに除外タグを**文字列としても書かないこと**。
// `scripts/api-surface.mjs` はタグを含む JSDoc の直後の宣言を丸ごと読み飛ばすので、
// 説明のつもりで書くと関係のない宣言が 1 つ消え、残りの JSDoc だけが漏れる。


/** 角度を 0 以上 360 未満へ畳む。外へは出さない（下の 4 つだけがドライバー向けの口）。 */
function normalizeDegrees360(degrees: number): number {
    if (!Number.isFinite(degrees)) return 0;
    const wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * MapConductor の bearing → heading 系ネイティブ SDK の値。
 *
 * カメラが向いている方位でもあるので、負 tilt エミュレーションで
 * 「カメラの前進方向」が要るときもこれを使う。
 * @internal
 */
export function toNativeHeading(bearing: number): number {
    return normalizeDegrees360(-bearing);
}

/**
 * heading 系ネイティブ SDK の値 → MapConductor の bearing。
 * @internal
 */
export function bearingFromNativeHeading(heading: number): number {
    return normalizeDegrees360(-heading);
}

/**
 * MapConductor の bearing → rotation 系ネイティブ SDK の値（向きが同じなので恒等）。
 * @internal
 */
export function toNativeRotation(bearing: number): number {
    return normalizeDegrees360(bearing);
}

/**
 * rotation 系ネイティブ SDK の値 → MapConductor の bearing（同上）。
 * @internal
 */
export function bearingFromNativeRotation(rotation: number): number {
    return normalizeDegrees360(rotation);
}
