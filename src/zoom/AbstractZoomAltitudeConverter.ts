export abstract class AbstractZoomAltitudeConverter {
    static readonly DEFAULT_ZOOM0_ALTITUDE = 171_319_879.0;
    static readonly ZOOM_FACTOR = 2.0;
    static readonly MIN_ZOOM_LEVEL = 0.0;
    static readonly MAX_ZOOM_LEVEL = 22.0;
    static readonly MIN_ALTITUDE = 100.0;
    static readonly MAX_ALTITUDE = 50_000_000.0;
    static readonly MIN_COS_LAT = 0.01;
    static readonly MIN_COS_TILT = 0.05;
    static readonly WEB_MERCATOR_INITIAL_MPP_256 = 156_543.033_928;

    constructor(protected readonly zoom0Altitude: number = AbstractZoomAltitudeConverter.DEFAULT_ZOOM0_ALTITUDE) {}

    abstract zoomLevelToAltitude(params: { zoomLevel: number; latitude: number; tilt: number }): number;
    abstract altitudeToZoomLevel(params: { altitude: number; latitude: number; tilt: number }): number;
}
