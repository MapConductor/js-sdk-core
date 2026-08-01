import { createGeoPoint, type GeoPoint } from "../features";
import { createInterpolatePoints } from "../sperical/CreateInterpolatePoints";
import { createLinearInterpolatePoints } from "../sperical/CreateLinearInterpolatePoints";
import { normalizeLngDegrees } from "./CircleGeometry";

/*
 * ポリライン／ポリゴン描画用の共通ジオメトリパイプライン（unwrap 版）。
 *
 * Mapbox GL / MapLibre GL 系は GeoJSON の経度が [-180, 180] を超えていてもそのまま
 * 描画できる。経度を連続化（unwrap）した単一ジオメトリを渡せば、±180 跨ぎでも分割
 * 不要で継ぎ目が出ず、外周が分割されることによる「穴を含められない」制約も無くなる。
 * 経度 ±180 に制約のある SDK は normalize + `splitByMeridian`／`splitRingByMeridian`
 * を使うこと。android-sdk / ios-sdk の geometry モジュールと同一仕様。
 */

/** ポリゴンの外周リングと穴リング。リングは閉じていない。 */
export interface PolygonRings {
    outerRings: GeoPoint[][];
    holeRings: GeoPoint[][];
}

/** geodesic に応じた補間で点列を密度化し、緯度経度を正規化して返す。 */
export function densifyAndNormalize(
    points: GeoPoint[],
    geodesic: boolean,
    maxSegmentLength: number = 10000.0,
): GeoPoint[] {
    const interpolated = geodesic
        ? createInterpolatePoints(points, maxSegmentLength)
        : createLinearInterpolatePoints(points);
    return interpolated.map((point) => point.normalize());
}

/**
 * 密度化済みの点列の経度を、直前の点からの最短差分を積み上げる形で連続化する。
 * 先頭点は `anchorLng`（省略時は正規化した自身の経度）から ±180 以内に配置する。
 */
function unwrapContinuous(points: GeoPoint[], anchorLng?: number): GeoPoint[] {
    if (points.length === 0) return points;
    const result: GeoPoint[] = [];
    const first = points[0];
    let prevLng =
        anchorLng == null
            ? normalizeLngDegrees(first.longitude)
            : anchorLng + normalizeLngDegrees(first.longitude - anchorLng);
    result.push(createGeoPoint({ latitude: first.latitude, longitude: prevLng }));
    for (let i = 1; i < points.length; i++) {
        const p = points[i];
        prevLng += normalizeLngDegrees(p.longitude - points[i - 1].longitude);
        result.push(createGeoPoint({ latitude: p.latitude, longitude: prevLng }));
    }
    return result;
}

/**
 * ポリライン用パイプライン（unwrap 版）。密度化後に経度を連続化した単一パスを返す。
 * 頂点 2 未満の入力は空配列を返す。
 */
export function buildUnwrappedPolylinePath(
    points: GeoPoint[],
    geodesic: boolean,
    maxSegmentLength: number = 10000.0,
): GeoPoint[] {
    if (points.length < 2) return [];
    return unwrapContinuous(
        densifyAndNormalize(points, geodesic, maxSegmentLength),
    );
}

/**
 * ポリゴン用パイプライン（unwrap 版）。外周・穴とも密度化し、外周の先頭経度を基準に
 * 同一の連続座標系へ unwrap する（±180 跨ぎでも常に外周 1 リング + 全穴を返せる）。
 * 頂点 3 未満の外周入力は空の結果を返し、3 点未満に縮退した穴は除外する。
 */
export function buildUnwrappedPolygonRings(
    points: GeoPoint[],
    holes: GeoPoint[][],
    geodesic: boolean,
    maxSegmentLength: number = 10000.0,
): PolygonRings {
    if (points.length < 3) return { outerRings: [], holeRings: [] };
    const outer = unwrapContinuous(
        densifyAndNormalize(points, geodesic, maxSegmentLength),
    );
    const anchor = outer[0].longitude;
    const holeRings = holes
        .filter((hole) => hole.length >= 3)
        .map((hole) =>
            unwrapContinuous(
                densifyAndNormalize(hole, geodesic, maxSegmentLength),
                anchor,
            ),
        )
        .filter((hole) => hole.length >= 3);
    return { outerRings: [outer], holeRings };
}
