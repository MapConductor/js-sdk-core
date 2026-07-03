import { HexCell } from "../geocell/HexCell";
import { Offset } from "./Offset";

/**
 * Configuration for spatial index
 */
export interface SpatialIndexConfig {
  /** Use WebAssembly implementation if available (default: true) */
  useWasm?: boolean;
  /** Zoom level for hex cell size calculation */
  zoom?: number;
  /** Base hex cell size in pixels */
  baseHexSize?: number;
}

/**
 * Spatial index interface for efficient nearest-neighbor queries
 */
export interface SpatialIndex {
  /**
   * Build the spatial index from hex cells
   */
  build(cells: HexCell[]): void;

  /**
   * Find the nearest cell to a query point
   */
  findNearest(query: Offset): HexCell | null;

  /**
   * Find k nearest cells
   */
  findKNearest(query: Offset, k: number): HexCell[];

  /**
   * Find all cells within a radius
   */
  findWithinRadius(query: Offset, radius: number): HexCell[];

  /**
   * Check if the index is empty
   */
  isEmpty(): boolean;

  /**
   * Clean up resources
   */
  dispose(): void;
}
