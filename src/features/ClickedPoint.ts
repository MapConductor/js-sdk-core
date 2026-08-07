import { fromGeoPoint, type GeoPoint, type GeoPointInterface } from './GeoPoint';

/**
 * クリック座標を [-180,180] / [-90,90] に正規化する（日付変更線対策）。
 *
 * android-sdk / ios-sdk では PolylineEvent / PolygonEvent / CircleEvent /
 * GroundImageEvent の **コンストラクタ** が `clicked.wrap()` を行い、どの配送経路を
 * 通っても wrap 漏れが起きないようにしている（Polyline.kt / Polygon.kt / Circle.kt /
 * GroundImage.kt）。TypeScript の `*Event` は素の interface でコンストラクタを持てないため、
 * 代わりにイベントを配送する直前にこの関数を通すことで同じ保証を得る。
 *
 * `clicked.wrap()` を直接呼ばないこと: `GeoPoint.wrap` はファクトリのクロージャに束縛された
 * メソッドで、プロバイダが組み立てるプレーンオブジェクトには存在しない
 * （`GeoPointInterface.wrap` は optional）。`fromGeoPoint` で正規の GeoPoint に
 * 引き上げてから wrap する。android-sdk の `GeoPoint.from(it.wrap())` に対応する。
 *
 * ヒットテストの**入力**座標は wrap しないこと。
 */
export function wrapClickedPoint(clicked: GeoPointInterface): GeoPoint;
export function wrapClickedPoint(clicked: GeoPointInterface | null | undefined): GeoPoint | null;
export function wrapClickedPoint(clicked: GeoPointInterface | null | undefined): GeoPoint | null {
    if (clicked == null) return null;
    return fromGeoPoint(clicked).wrap();
}
