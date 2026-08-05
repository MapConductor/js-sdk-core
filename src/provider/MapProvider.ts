import type { MapViewControllerInterface } from '../controller/MapViewControllerInterface';
import type { MapCameraPosition } from '../types';

/**
 * Configuration options for initializing a map
 */
export interface MapConfig {
  /** Container element for the map */
  container: HTMLElement | string;
  /** API key or access token for the map provider */
  apiKey?: string;
  /**
   * Additional provider-specific options. Deliberately typed as `Record<string,
   * any>`: provider configs extend MapConfig and NARROW this to their own
   * option interface (e.g. LeafletConfig -> Leaflet's `MapOptions`), which is
   * only assignable when the base is permissive. `Record<string, unknown>` would
   * break that subtyping (TS2430), so `any` is intentional here.
   */
  // eslint-disable-next-line typescript/no-explicit-any
  options?: Record<string, any>;
  
  initCameraPosition: MapCameraPosition;
}

/**
 * Abstract base class for map providers
 */
export abstract class MapProvider {
  protected controller: MapViewControllerInterface | null = null;

  /**
   * Initialize the map provider
   */
  abstract initialize(config: MapConfig): Promise<MapViewControllerInterface>;

  /**
   * Get the current controller instance
   */
  getController(): MapViewControllerInterface | null {
    return this.controller;
  }

  /**
   * Check if the provider is initialized
   */
  isInitialized(): boolean {
    return this.controller !== null;
  }

  /**
   * Clean up resources
   */
  abstract destroy(): void;
}

/**
 * Map provider types
 */
export enum MapProviderType {
  GOOGLE_MAPS = 'google-maps',
  MAPLIBRE = 'maplibre',
  MAPBOX = 'mapbox',
  HERE = 'here',
  ARCGIS = 'arcgis',
}
