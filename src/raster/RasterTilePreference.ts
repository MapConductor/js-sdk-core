import { createMapServiceKey, type MapServiceKey } from '../map/MapServiceRegistry';

/**
 * どの大きさのタイルなら、この地図 SDK がうまく扱えるか。
 *
 * タイルの一辺は本来アプリの好みで決めてよく、既定は 512。1 枚あたりの固定費
 * （タイルサーバへの往復、PNG の符号化・復号、レンダラの立ち上げ）が枚数に比例
 * するので、同じ画面を覆うなら枚数は少ないほうが安い。
 *
 * ところが SDK 側に都合があることがあり、その都合はタイルを供給する側からは
 * 見えない。実例が ArcGIS の 3D SceneView で、**タイルは 256px** という前提で
 * レベルを選ぶ。512px のタイルを渡すと 1 段深いレベルを 4 倍の枚数で取りに行く
 * （Android 実機・統一ズーム 12 で、2D は z=11、3D は z=12）。絵は正しいので
 * 気づきにくく、遅い端末ほど効く。
 *
 * android-sdk の `RasterTilePreference.kt`、ios-sdk の `RasterTilePreference.swift`
 * と同じもの。
 */
export interface RasterTilePreference {
    /** この SDK に渡してほしいタイルの一辺（CSS px）。 */
    readonly preferredTileSize: number;
    /**
     * この SDK がラスタータイルを **device px** でレイアウトするなら true。
     *
     * 地図 SDK には 2 つの流儀がある。Google Maps や Leaflet は宣言された
     * 一辺を CSS px として敷き、HERE は device px として敷く。2x の画面で
     * 「512」と宣言すると、前者は 512 CSS px、後者は 256 CSS px しか覆わず、
     * HERE は 1 段深いズームを要求してスタイルをそこで読む — ラベルは半分、
     * 道路は倍の密度になる。供給側（ベクタータイルのラスタライザ）はこの
     * 流儀を知りようがないので、プロバイダが言う。
     *
     * true のとき、供給側は {@link preferredTileSize} × devicePixelRatio を
     * 宣言し、描画は同じピクセル数で行い、スタイルには
     * {@link preferredTileSize} CSS px として読ませる。省略時は false。
     */
    readonly layoutInDevicePixels?: boolean;
}

/**
 * {@link RasterTilePreference} の登録キー。
 *
 * 宣言しないプロバイダは「好みは無い」。その場合は供給側の既定が使われる。
 */
export const RasterTilePreferenceKey: MapServiceKey<RasterTilePreference> =
    createMapServiceKey<RasterTilePreference>();
