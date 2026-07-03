/**
 * Base interface for map design types (style / map type).
 * Mirrors Android MapDesignTypeInterface<T> / iOS MapDesignTypeProtocol.
 *
 * T is String for MapLibre (style URL), String for Google Maps JS (map type id string).
 * Note: Android Google Maps uses Int for T; TypeScript uses string because
 * the Google Maps JS API identifies map types as strings ('roadmap', 'satellite', etc.).
 */
export interface MapDesignTypeInterface<T> {
  readonly id: T;
  getValue(): T;
}
