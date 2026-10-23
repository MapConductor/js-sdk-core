import type { Offset } from "../types";
import { createGeoPoint, type GeoPointInterface } from "../features/GeoPoint";
import { createGeoRectBounds, type GeoRectBounds } from "../features/GeoRectBounds";

// タップ点に当たるマーカーを選ぶ規則（android-sdk / ios-sdk の `MarkerHitTest.pickIndex` と同じ）。
//
// 1. アイコン（ラベル込み）の矩形そのものにタップ点が入っているものがあれば、その中で
//    画面上いちばん下にアンカーがあるもの（手前に描かれるもの）を選ぶ。近くに別のマーカーの
//    先端があっても、指の下に描かれているマーカーが勝つ。
// 2. どの矩形にも入っていなければ、矩形 + tolerance に入るもののうち、アンカーが
//    タップ点にいちばん近いものを選ぶ。
//
// 通常マーカーとタイル化マーカーのように別々に探した結果は {@link preferMarkerHit} で
// 同じ規則に従って 1 つにまとめる。

/** @internal アンカー点を投影した画面座標と、そのアイコンの矩形（CSS px）。 */
export interface MarkerHitRect {
    anchorScreen: Offset;
    width: number;
    height: number;
    anchor: Offset;
}

/** @internal 1 つの候補が当たった結果。`exact` は矩形そのもの（許容量なし）に入ったか。 */
export interface MarkerHit<T> {
    item: T;
    exact: boolean;
    /** アンカーの画面 y。`exact` 同士はこれが大きい（手前の）方が勝つ。 */
    anchorY: number;
    /** タップ点とアンカーの距離（px）。`exact` でない同士はこれが小さい方が勝つ。 */
    distance: number;
}

/**
 * 候補を探す半径（CSS px）。ラベルの長さの上限の目安で、これより遠くまで伸びたラベルの端は拾えない。
 * android-sdk / ios-sdk の `SEARCH_RADIUS` と同じ値。
 *
 * @internal
 */
export const MARKER_HIT_SEARCH_RADIUS_PX = 256;

function containsRect(dx: number, dy: number, rect: MarkerHitRect, tolerance: number): boolean {
    const left = -rect.anchor.x * rect.width - tolerance;
    const right = (1 - rect.anchor.x) * rect.width + tolerance;
    const top = -rect.anchor.y * rect.height - tolerance;
    const bottom = (1 - rect.anchor.y) * rect.height + tolerance;
    return dx >= left && dx <= right && dy >= top && dy <= bottom;
}

/** @internal `a` と `b` のうち、上の規則で勝つ方。どちらかが null ならもう一方。 */
export function preferMarkerHit<T>(a: MarkerHit<T> | null, b: MarkerHit<T> | null): MarkerHit<T> | null {
    if (!a) return b;
    if (!b) return a;
    if (a.exact !== b.exact) return a.exact ? a : b;
    if (a.exact) return b.anchorY > a.anchorY ? b : a;
    return b.distance < a.distance ? b : a;
}

/** @internal `candidates` の中からタップ点に当たるものを選ぶ。`rectOf` が null を返した候補は飛ばす。 */
export function pickMarkerHit<T>(
    touch: Offset,
    candidates: Iterable<T>,
    rectOf: (item: T) => MarkerHitRect | null,
    tolerance: number,
): MarkerHit<T> | null {
    let best: MarkerHit<T> | null = null;
    for (const item of candidates) {
        const rect = rectOf(item);
        if (!rect) continue;
        const dx = touch.x - rect.anchorScreen.x;
        const dy = touch.y - rect.anchorScreen.y;
        let hit: MarkerHit<T> | null = null;
        if (containsRect(dx, dy, rect, 0)) {
            hit = { item, exact: true, anchorY: rect.anchorScreen.y, distance: Math.hypot(dx, dy) };
        } else if (containsRect(dx, dy, rect, tolerance)) {
            hit = { item, exact: false, anchorY: rect.anchorScreen.y, distance: Math.hypot(dx, dy) };
        }
        best = preferMarkerHit(best, hit);
    }
    return best;
}

/** @internal {@link pickMarkerHit} の、矩形の配列からインデックスを返す版（テスト用の純粋な幾何）。 */
export function pickMarkerIndex(touch: Offset, rects: MarkerHitRect[], tolerance: number): number | null {
    const hit = pickMarkerHit(touch, rects.map((rect, index) => ({ rect, index })), c => c.rect, tolerance);
    return hit ? hit.item.index : null;
}

/**
 * 候補を集める範囲。タップ点から画面上 {@link MARKER_HIT_SEARCH_RADIUS_PX} 以内に先端があるマーカーを含む。
 *
 * ラベルを横に置くとアイコンはピンより大きく広がるので、最寄りの 1 つだけでは足りない。
 * px → 度の換算は、タップ点の近くを投影して局所的に求める（回転していても各軸の長さは保たれる）。
 *
 * @internal
 */
export function markerSearchBounds(
    position: GeoPointInterface,
    touchScreen: Offset,
    project: (position: GeoPointInterface) => Offset | null,
    searchRadiusPx: number = MARKER_HIT_SEARCH_RADIUS_PX,
): GeoRectBounds | null {
    const epsilon = 1e-4;
    const north = project(createGeoPoint({ latitude: position.latitude + epsilon, longitude: position.longitude }));
    const east = project(createGeoPoint({ latitude: position.latitude, longitude: position.longitude + epsilon }));
    if (!north || !east) return null;
    const pxPerDegLat = Math.hypot(north.x - touchScreen.x, north.y - touchScreen.y) / epsilon;
    const pxPerDegLon = Math.hypot(east.x - touchScreen.x, east.y - touchScreen.y) / epsilon;
    if (!(pxPerDegLat > 0) || !(pxPerDegLon > 0)) return null;
    const halfLat = searchRadiusPx / pxPerDegLat;
    const halfLon = searchRadiusPx / pxPerDegLon;
    return createGeoRectBounds({
        southWest: createGeoPoint({
            latitude: Math.max(position.latitude - halfLat, -90),
            longitude: position.longitude - halfLon,
        }),
        northEast: createGeoPoint({
            latitude: Math.min(position.latitude + halfLat, 90),
            longitude: position.longitude + halfLon,
        }),
    });
}
