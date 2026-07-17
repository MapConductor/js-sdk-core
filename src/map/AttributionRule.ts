import type { GeoRectBounds } from '../features';
import type { MapCameraPosition } from '../types';

export interface AttributionRule {
  attribution: string;
  minZoom?: number;
  maxZoom?: number;
  bounds?: GeoRectBounds;
}

export function resolveAttributionRules(
  rules: readonly AttributionRule[],
  camera: MapCameraPosition,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const visibleBounds = camera.visibleRegion?.bounds ?? null;
  const tileZoom = Math.floor(camera.zoom);

  for (const rule of rules) {
    if (rule.minZoom != null && tileZoom < rule.minZoom) continue;
    if (rule.maxZoom != null && tileZoom > rule.maxZoom) continue;
    if (rule.bounds) {
      const matchesBounds = visibleBounds
        ? rule.bounds.intersects(visibleBounds)
        : rule.bounds.contains(camera.position);
      if (!matchesBounds) continue;
    }

    const attribution = rule.attribution.trim();
    if (!attribution || seen.has(attribution)) continue;
    seen.add(attribution);
    result.push(attribution);
  }
  return result;
}
