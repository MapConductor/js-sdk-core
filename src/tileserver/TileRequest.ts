export interface TileRequest {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    /**
     * Device pixels per CSS pixel to draw the tile at (the `@2x` in its URL).
     * Absent means 1. A provider that does not draw at other ratios may ignore
     * it: the map still lays the tile out at its CSS size, just less sharply.
     */
    readonly pixelRatio?: number;
}
