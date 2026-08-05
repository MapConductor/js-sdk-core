import { type GeoPoint } from "../features";
import { closeRing } from "./CircleGeometry";
import { type PolygonRings } from "./OverlayGeometry";

/**
 * WebView 系ドライバー（MapTiler／Longdo 等）向けの GeoJSON Feature 文字列ビルダー。
 *
 * 座標は経度・緯度の順。properties は常に空オブジェクトで、数値座標のみを扱うため
 * エスケープは不要。出力形式は android-sdk / ios-sdk の実装と互換。
 */
export const OverlayGeoJson = {
    /** MultiLineString の Feature を生成する。セグメントが空なら null。 */
    multiLineStringFeature(segments: GeoPoint[][]): string | null {
        if (segments.length === 0) return null;
        const coordinates = segments
            .map(
                (segment) =>
                    "[" +
                    segment.map((p) => `[${p.longitude},${p.latitude}]`).join(",") +
                    "]",
            )
            .join(",");
        return (
            '{"type":"Feature","geometry":' +
            `{"type":"MultiLineString","coordinates":[${coordinates}]},"properties":{}}`
        );
    },

    /**
     * Polygon（外周 1 つ＋穴）または MultiPolygon（外周複数、穴なし）の Feature を生成する。
     * 各リングは自動的に閉じる。外周が空なら null。
     */
    polygonFeature(rings: PolygonRings): string | null {
        const { outerRings } = rings;
        if (outerRings.length === 0) return null;
        if (outerRings.length === 1) {
            const ringJsons = [ringToJson(outerRings[0])];
            for (const hole of rings.holeRings) ringJsons.push(ringToJson(hole));
            const coordinates = "[" + ringJsons.join(",") + "]";
            return (
                '{"type":"Feature","geometry":' +
                `{"type":"Polygon","coordinates":${coordinates}},"properties":{}}`
            );
        }
        const polygons = outerRings.map((r) => `[${ringToJson(r)}]`).join(",");
        return (
            '{"type":"Feature","geometry":' +
            `{"type":"MultiPolygon","coordinates":[${polygons}]},"properties":{}}`
        );
    },

    /** 穴のないリング列（円の分割結果等）を Polygon／MultiPolygon の Feature へ変換する。 */
    ringsFeature(rings: GeoPoint[][]): string | null {
        return this.polygonFeature({ outerRings: rings, holeRings: [] });
    },
};

function ringToJson(ring: GeoPoint[]): string {
    return (
        "[" +
        closeRing(ring)
            .map((p) => `[${p.longitude},${p.latitude}]`)
            .join(",") +
        "]"
    );
}
