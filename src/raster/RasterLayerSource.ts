import { resolveAttributionRules, type AttributionRule } from "../map";
import type { MapCameraPosition } from "../types";

export enum TileScheme {
    XYZ = "XYZ",
    TMS = "TMS",
}

export type RasterAttributionRule = AttributionRule;

export type RasterLayerSource =
    | { type: "UrlTemplate"; template: string; tileSize?: number; minZoom?: number | null; maxZoom?: number | null; attributionRules?: AttributionRule[]; scheme?: TileScheme }
    | { type: "TileJson"; url: string }
    | { type: "ArcGisService"; serviceUrl: string };

export const RasterLayerSource = {
    DEFAULT_TILE_SIZE: 512,
    UrlTemplate(params: { template: string; tileSize?: number; minZoom?: number | null; maxZoom?: number | null; attributionRules?: AttributionRule[]; scheme?: TileScheme }): RasterLayerSource {
        return { type: "UrlTemplate", ...params };
    },
    TileJson(url: string): RasterLayerSource {
        return { type: "TileJson", url };
    },
    ArcGisService(serviceUrl: string): RasterLayerSource {
        return { type: "ArcGisService", serviceUrl };
    },
};

export function resolveRasterAttributions(
    sources: RasterLayerSource[],
    camera: MapCameraPosition,
): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const tileZoom = Math.floor(camera.zoom);

    for (const source of sources) {
        if (source.type !== "UrlTemplate") continue;
        if (source.minZoom != null && tileZoom < source.minZoom) continue;
        if (source.maxZoom != null && tileZoom > source.maxZoom) continue;
        for (const attribution of resolveAttributionRules(source.attributionRules ?? [], camera)) {
            if (seen.has(attribution)) continue;
            seen.add(attribution);
            result.push(attribution);
        }
    }
    return result;
}
