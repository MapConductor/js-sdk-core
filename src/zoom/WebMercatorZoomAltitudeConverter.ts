import { AbstractZoomAltitudeConverter } from './AbstractZoomAltitudeConverter';

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Web Mercator 系の地図SDK向けの、統一ズーム ⇄ 高度の変換。
 *
 * 統一ズームは Google Maps 基準（256px タイル）。各 SDK のネイティブズームとの差は
 * {@link zoomOffsetAt} だけなので、そこをパラメータにして実装を 1 本にまとめてある。
 *
 * ```
 * unifiedZoom = nativeZoom + zoomOffsetAt(latitude)
 * distance    = zoom0Altitude * cos(latitude) / 2^unifiedZoom
 * altitude    = distance * cos(tilt)
 * ```
 *
 * ## 継承ではなく合成で選ぶこと
 *
 * これは {@link AbstractZoomAltitudeConverter} の「既定の実装」ではなく、
 * **Web Mercator の参照実装**である。全プロバイダの親にしてはいけない。
 * ズームが `2^n` のスケール則に載らない SDK（ビューポート高さでスケールする
 * Map3DElement / Cesium / ArcGIS、WMTS の離散 scale-set、3D globe）では
 * この式自体が成立しない。そうした SDK は {@link AbstractZoomAltitudeConverter} を
 * 直接継承する。
 *
 * 較正定数（`zoom0Altitude`）も**プロバイダが持つ**。同じプロバイダでもプラットフォームで
 * 値が違う実例がある（ArcGIS の zoom0Altitude は iOS 141,600,000 /
 * Android・React 136,500,000）。コアに固定しないこと。
 *
 * @param zoomOffset `unifiedZoom = nativeZoom + zoomOffset`。512px タイルのベクタ
 *   エンジン（MapLibre / Mapbox / MapTiler / Azure Maps / TomTom web / Longdo web）は 1.0、
 *   256px 基準（MapKit JS / HERE for JavaScript）は 0.0。緯度に依存するプロバイダは
 *   {@link GroundScaleZoomAltitudeConverter} を使う。
 */
export class WebMercatorZoomAltitudeConverter extends AbstractZoomAltitudeConverter {
    constructor(
        zoom0Altitude: number = AbstractZoomAltitudeConverter.DEFAULT_ZOOM0_ALTITUDE,
        private readonly zoomOffset: number = 0.0,
    ) {
        super(zoom0Altitude);
    }

    /**
     * ネイティブズームに足すと統一ズームになる量。既定は緯度によらず `zoomOffset`。
     *
     * グラウンドスケール基準の SDK は緯度に依存するのでここを上書きする
     * （{@link GroundScaleZoomAltitudeConverter} を参照）。
     */
    protected zoomOffsetAt(_latitude: number): number {
        return this.zoomOffset;
    }

    /** ネイティブズーム → 統一ズーム（Google Maps 基準）。 */
    toUnifiedZoom(nativeZoom: number, latitude = 0.0): number {
        return clamp(
            nativeZoom + this.zoomOffsetAt(latitude),
            AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL,
            AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL,
        );
    }

    /** 統一ズーム（Google Maps 基準） → ネイティブズーム。 */
    toNativeZoom(unifiedZoom: number, latitude = 0.0): number {
        return clamp(
            unifiedZoom - this.zoomOffsetAt(latitude),
            AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL,
            AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL,
        );
    }

    /**
     * 緯度による水平スケール補正。極付近で発散しないよう緯度を ±85° に、
     * 係数を `MIN_COS_LAT` にクランプする。
     */
    protected cosLatitudeFactor(latitudeDeg: number): number {
        const clamped = clamp(latitudeDeg, -85, 85);
        return Math.max(AbstractZoomAltitudeConverter.MIN_COS_LAT, Math.abs(Math.cos((clamped * Math.PI) / 180)));
    }

    /** 傾きによる視距離補正。真横（90°）で発散しないよう `MIN_COS_TILT` にクランプする。 */
    protected cosTiltFactor(tiltDeg: number): number {
        const clamped = clamp(tiltDeg, 0, 90);
        return Math.max(AbstractZoomAltitudeConverter.MIN_COS_TILT, Math.cos((clamped * Math.PI) / 180));
    }

    zoomLevelToAltitude({
        zoomLevel,
        latitude,
        tilt,
    }: {
        zoomLevel: number;
        latitude: number;
        tilt: number;
    }): number {
        const unifiedZoom = this.toUnifiedZoom(zoomLevel, latitude);
        const distance =
            (this.zoom0Altitude * this.cosLatitudeFactor(latitude)) /
            Math.pow(AbstractZoomAltitudeConverter.ZOOM_FACTOR, unifiedZoom);
        return clamp(
            distance * this.cosTiltFactor(tilt),
            AbstractZoomAltitudeConverter.MIN_ALTITUDE,
            AbstractZoomAltitudeConverter.MAX_ALTITUDE,
        );
    }

    altitudeToZoomLevel({
        altitude,
        latitude,
        tilt,
    }: {
        altitude: number;
        latitude: number;
        tilt: number;
    }): number {
        const clampedAltitude = clamp(
            altitude,
            AbstractZoomAltitudeConverter.MIN_ALTITUDE,
            AbstractZoomAltitudeConverter.MAX_ALTITUDE,
        );
        const distance = clampedAltitude / this.cosTiltFactor(tilt);
        const unifiedZoom = Math.log2((this.zoom0Altitude * this.cosLatitudeFactor(latitude)) / distance);
        return this.toNativeZoom(unifiedZoom, latitude);
    }
}

/**
 * グラウンドスケール基準（画面上の meter/pixel が緯度によらず一定）でズームを定義する
 * SDK 向け。Web Mercator 基準との差が `log2(cos φ)` なので、そこだけを足す。
 *
 * web のプロバイダで今これを使うものは無い（TomTom の web SDK は maplibre 系なので
 * オフセットは 1.0 固定）。ネイティブの TomTom SDK（android-for-tomtom /
 * ios-for-tomtom）がこちらを使っており、3 プラットフォームで形を揃えるために置いてある。
 *
 * @param baseZoomOffset 赤道でのオフセット。ネイティブ TomTom は 1.76（実測較正値）。
 */
export class GroundScaleZoomAltitudeConverter extends WebMercatorZoomAltitudeConverter {
    constructor(
        zoom0Altitude: number = AbstractZoomAltitudeConverter.DEFAULT_ZOOM0_ALTITUDE,
        private readonly baseZoomOffset: number = 0.0,
    ) {
        super(zoom0Altitude, baseZoomOffset);
    }

    protected override zoomOffsetAt(latitude: number): number {
        return this.baseZoomOffset + Math.log2(this.cosLatitudeFactor(latitude));
    }
}
