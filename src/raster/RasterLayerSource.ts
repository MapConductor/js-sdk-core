export enum TileScheme {
    XYZ = "XYZ",
    TMS = "TMS",
}

export type RasterLayerSource =
    | { type: "UrlTemplate"; template: string; tileSize?: number; minZoom?: number | null; maxZoom?: number | null; attribution?: string | null; scheme?: TileScheme }
    | { type: "TileJson"; url: string }
    | { type: "ArcGisService"; serviceUrl: string };

export const RasterLayerSource = {
    DEFAULT_TILE_SIZE: 512,
    UrlTemplate(params: { template: string; tileSize?: number; minZoom?: number | null; maxZoom?: number | null; attribution?: string | null; scheme?: TileScheme }): RasterLayerSource {
        return { type: "UrlTemplate", ...params };
    },
    TileJson(url: string): RasterLayerSource {
        return { type: "TileJson", url };
    },
    ArcGisService(serviceUrl: string): RasterLayerSource {
        return { type: "ArcGisService", serviceUrl };
    },
};
