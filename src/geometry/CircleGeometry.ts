import { createGeoPoint, type GeoPoint } from "../features";
import { Earth } from "../projection/Earth";
import { computeOffset } from "../spherical/Spherical";

/** 円リング近似の既定分割数。 */
export const DEFAULT_CIRCLE_SEGMENTS = 128;

/** 経度を [-180, 180] へ正規化する（geometry モジュール共有ヘルパー）。 */
export function normalizeLngDegrees(lng: number): number {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * 円を頂点列（開いたリング）へ変換する共通ジオメトリ。各アダプターはこの結果を
 * 自 SDK の型へ変換して描画するだけにする（円の形状定義を全プロバイダで統一する）。
 *
 * - geodesic=true : 球面上で中心から等距離のリング（`Spherical.computeOffset`）。
 * - geodesic=false: 中心緯度の局所平面（正距円筒）近似での等距離リング。
 *   小さな半径・低〜中緯度では geodesic とほぼ一致する。
 *
 * 経度は中心経度まわりに連続化（unwrap）して返す。±180 を跨ぐ円でも経度が飛ばないため、
 * 範囲外経度を扱える GL 系 SDK（Mapbox GL / MapLibre GL 等）はこのまま 1 枚の
 * ポリゴンとして描画できる（子午線の継ぎ目が出ない）。経度 ±180 に制約のある SDK は、
 * 各点を normalize してから `splitRingByMeridian` で分割すること。
 *
 * リングは閉じていない（必要なら `closeRing` を使う）。半径 0 以下・分割数 3 未満は
 * 空配列を返す。android-sdk / ios-sdk の `circleToRing` と同一仕様。
 */
export function circleToRing(
    center: GeoPoint,
    radiusMeters: number,
    geodesic: boolean,
    segments: number = DEFAULT_CIRCLE_SEGMENTS,
): GeoPoint[] {
    if (radiusMeters <= 0 || segments < 3) return [];
    if (geodesic) {
        return Array.from({ length: segments }, (_, i) => {
            const p = computeOffset({
                origin: center,
                distance: radiusMeters,
                heading: (360.0 * i) / segments,
            });
            return createGeoPoint({
                latitude: p.latitude,
                // 中心経度まわりに連続化する。
                longitude:
                    center.longitude +
                    normalizeLngDegrees(p.longitude - center.longitude),
            });
        });
    }
    const metersPerDegree = Earth.CIRCUMFERENCE_METERS / 360.0;
    // 極付近で経度補正が発散しないよう下限を設ける。
    const latCorrection = Math.max(
        Math.cos((center.latitude * Math.PI) / 180.0),
        1e-6,
    );
    return Array.from({ length: segments }, (_, i) => {
        const angle = (2.0 * Math.PI * i) / segments;
        const deltaLat = (radiusMeters / metersPerDegree) * Math.cos(angle);
        const deltaLng =
            (radiusMeters / (metersPerDegree * latCorrection)) * Math.sin(angle);
        return createGeoPoint({
            latitude: Math.max(-90, Math.min(90, center.latitude + deltaLat)),
            longitude: center.longitude + deltaLng,
        });
    });
}

/** リングが閉じていなければ先頭点を末尾へ追加して閉じる。 */
export function closeRing(ring: GeoPoint[]): GeoPoint[] {
    if (ring.length === 0) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.latitude === last.latitude && first.longitude === last.longitude) {
        return ring;
    }
    return [...ring, first];
}
