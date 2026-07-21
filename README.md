English | [日本語](./README.ja.md) | [Español (Latinoamérica)](./README.es-419.md)

# @mapconductor/js-sdk-core

Core abstractions for the MapConductor JS SDKs: geometry, camera, observable
map and overlay state, controller interfaces, and shared types. The package is
platform-neutral — no React or DOM dependency — and everything else builds on
it: `@mapconductor/js-sdk-react` and every provider package
(`react-for-googlemaps`, `react-for-maplibre`, `react-for-here`, …).

## Installation

Installing any provider package pulls this in automatically. Install it
explicitly when you import from it directly (which typical application code
does), with pnpm's strict (isolated) `node_modules`, or when building your own
provider or extension:

```shell
npm install @mapconductor/js-sdk-core
```

## Quick start

Application code creates provider-neutral state here and hands it to any
provider view:

```ts
import {
  createGeoPoint,
  createMapCameraPosition,
  createMarkerState,
} from '@mapconductor/js-sdk-core';

const tokyo = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });

// Camera position in Google Maps zoom semantics — shared by all providers.
const camera = createMapCameraPosition({ position: tokyo, zoom: 12 });

// Observable marker state. Render it with <Marker state={...}> from
// @mapconductor/js-sdk-react on any provider; mutations update the view.
const marker = createMarkerState({ id: 'tokyo', position: tokyo });
```

See the `react-for-*` package READMEs for complete map examples.

## What's inside

- Geometry and spherical utilities: `GeoPoint`, bounds, offsets, projections
- Camera: `MapCameraPosition` with Google Maps zoom semantics, plus
  zoom/altitude conversion shared by the provider packages
- Observable overlay states: marker, circle, polyline, polygon, ground image,
  and raster layer
- Bulk-marker tiling (`MarkerTilingOptions`) and geocell helpers
- Local tile server infrastructure (including the `tile-sw.js` service-worker
  entry point)
- Controller and provider interfaces implemented by each `react-for-*` package

## Development notes

The logic in this package must stay synchronized with the core module of the
MapConductor Android SDK.

## Related packages

- [`@mapconductor/js-sdk-react`](../js-sdk-react) — shared `Marker`, `Markers`, shapes, and info bubbles
- `@mapconductor/react-for-*` — provider packages (Google Maps, MapLibre, Mapbox, Leaflet, OpenLayers, ArcGIS, Cesium, HERE)
