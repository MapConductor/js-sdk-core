import type { GeoPoint } from '../features/GeoPoint';
import { createGeoRectBounds } from '../features/GeoRectBounds';
import type { Offset } from '../types/Offset';
import type { VisibleRegion } from '../types/VisibleRegion';
import type { MapViewHolder } from './MapViewHolder';

/** ビューポートの大きさ（px）。 */
export interface ViewportSize {
    readonly width: number;
    readonly height: number;
}

/**
 * ビューポートの 4 隅を逆投影して {@link VisibleRegion} を組み立てる。
 *
 * react-for-maplibre / mapbox / maptiler / tomtom / longdo / leaflet / azuremaps /
 * cesium が同じ 18 行を各自持っていたものの集約。android-sdk の
 * `VisibleRegionBuilder.kt`、ios-sdk の `VisibleRegionBuilder.swift` と
 * 同じ形・同じ隅の割り当て。
 *
 * ## 使えないプロバイダがある
 *
 * すべてのプロバイダがこの形ではない。無理に寄せないこと。
 *  - **googlemaps**: ネイティブの `projection.getVisibleRegion()` を使う。
 *    SDK が返す値の方が正確なので 4 隅の逆投影に置き換えない。
 *  - **here**: bounds はネイティブの `getBoundingBox()` から取る。
 *  - **arcgis**: カメラから幾何的に算出する。
 *  - **mapkit / openlayers**: ネイティブの extent から直接得られる。
 *
 * @param holder 投影の注入点。同期の逆投影を持たないホルダーでは null を返す。
 * @param size ビューポートの大きさ。0 なら null。
 * @param inset 端から何 px 内側の点を使うか。0 なら端ちょうど。
 * @param requireAllCorners `true`（既定）なら 4 隅すべてが解けないと null を返す。
 *   `false` なら解けた隅だけで bounds を作り、解けなかった隅は null のまま残す。
 *   傾けた地図や球体表示では隅の逆投影が地表に当たらないことがあり、そこで
 *   `VisibleRegion` ごと落とすと marker-clustering がビューポートを算出できず
 *   クラスタが一切描画されなくなる。それを避けたいプロバイダが `false` を使う。
 * @returns 隅が 1 つも解けなければ null。
 */
export function buildVisibleRegion(
    holder: Pick<MapViewHolder<unknown, unknown>, 'fromScreenOffsetSync'>,
    size: ViewportSize,
    { inset = 0, requireAllCorners = true }: { inset?: number; requireAllCorners?: boolean } = {},
): VisibleRegion | null {
    if (!size.width || !size.height) return null;

    const left = inset;
    const top = inset;
    const right = size.width - inset;
    const bottom = size.height - inset;

    const at = (offset: Offset): GeoPoint | null => holder.fromScreenOffsetSync(offset);

    const nearLeft = at({ x: left, y: bottom });
    const nearRight = at({ x: right, y: bottom });
    const farLeft = at({ x: left, y: top });
    const farRight = at({ x: right, y: top });

    const corners = [nearLeft, nearRight, farLeft, farRight].filter(
        (corner): corner is GeoPoint => corner != null,
    );
    if (requireAllCorners && corners.length < 4) return null;
    if (corners.length === 0) return null;

    // bounds は 4 隅から extend する。`map.getBounds()` の軸並行矩形と違い、
    // 地図が回転していても正しい。
    const bounds = createGeoRectBounds();
    corners.forEach((corner) => bounds.extend(corner));

    return { bounds, nearLeft, nearRight, farLeft, farRight };
}

/**
 * DOM 要素からビューポートの大きさを解決する。
 *
 * GL 系は `map.getCanvas()`、その他は地図のコンテナ要素を渡す。
 * まだレイアウト前（幅か高さが 0）なら null。
 */
export function viewportSizeOf(element: HTMLElement | null | undefined): ViewportSize | null {
    if (!element) return null;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (!width || !height) return null;
    return { width, height };
}
