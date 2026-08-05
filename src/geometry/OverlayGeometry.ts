import { createGeoPoint, type GeoPoint } from "../features";
import { WGS84Geodesic, Planar } from "../sperical";
import { splitByMeridian } from "../sperical/SplitByMeridian";
import { normalizeLngDegrees } from "./CircleGeometry";
import { splitRingByMeridian } from "./SplitRingByMeridian";

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
        ? WGS84Geodesic.createInterpolatePoints(points, maxSegmentLength)
        : Planar.createInterpolatePoints(points);
    return interpolated.map((point) => point.normalize());
}

// ─── 分割版パイプライン（経度 ±180 に制約のある SDK 向け） ─────────────────────
//
// 経度 ±180 を超える座標を受け付けない SDK は、密度化・正規化後に子午線で分割した複数
// リングとして描画する。GL 系は代わりに buildUnwrappedPolylinePath／buildUnwrappedPolygonRings
// （unwrap 版）を使うこと。android-sdk / ios-sdk と同一仕様。

/**
 * ポリライン用パイプライン（分割版）。密度化・正規化後に子午線で分割したセグメント列を返す。
 * 頂点 2 未満の入力、および分割で 2 点未満になったセグメントは除く（空配列になり得る）。
 */
export function buildPolylineSegments(
    points: GeoPoint[],
    geodesic: boolean,
): GeoPoint[][] {
    if (points.length < 2) return [];
    return splitByMeridian(densifyAndNormalize(points, geodesic), geodesic).filter(
        (segment) => segment.length >= 2,
    );
}

/**
 * ポリゴン用パイプライン（分割版）。外周を密度化→分割し、穴も同じ方式で密度化する。
 *
 * 外周が子午線で複数リングに分割された場合、穴を分割後の各ピースへ再割当てできないため
 * 穴を含めない（従来から全 GeoJSON 系ドライバー共通の仕様）。頂点 3 未満の外周入力は
 * 空の結果を返し、3 点未満に縮退したリングは除外する。
 */
export function buildPolygonRings(
    points: GeoPoint[],
    holes: GeoPoint[][],
    geodesic: boolean,
): PolygonRings {
    if (points.length < 3) return { outerRings: [], holeRings: [] };
    const outerRings = splitRingByMeridian(
        densifyAndNormalize(points, geodesic),
        geodesic,
    ).filter((ring) => ring.length >= 3);
    const includeHoles = holes.length > 0 && outerRings.length === 1;
    const holeRings = includeHoles
        ? holes
              .filter((hole) => hole.length >= 3)
              .map((hole) => densifyAndNormalize(hole, geodesic))
              .filter((hole) => hole.length >= 3)
        : [];
    return { outerRings, holeRings };
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
