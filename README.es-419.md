[English](./README.md) | [日本語](./README.ja.md) | Español (Latinoamérica)

# @mapconductor/js-sdk-core

Abstracciones centrales de los SDK de JavaScript de MapConductor: geometría, cámara, estado observable de mapas y superposiciones, interfaces de controladores y tipos compartidos. El paquete es neutral en cuanto a plataforma — sin dependencia de React ni del DOM — y todo lo demás se construye sobre él: `@mapconductor/js-sdk-react` y todos los paquetes de proveedor (`react-for-googlemaps`, `react-for-maplibre`, `react-for-here`, …).

## Instalación

Instalar cualquier paquete de proveedor lo incluye automáticamente. Instálalo explícitamente cuando importes directamente de él (lo que hace el código de aplicación típico), con el `node_modules` estricto (aislado) de pnpm, o cuando construyas tu propio proveedor o extensión:

```shell
npm install @mapconductor/js-sdk-core
```

## Inicio rápido

El código de aplicación crea aquí estado neutral respecto al proveedor y se lo entrega a cualquier vista de proveedor:

```ts
import {
  createGeoPoint,
  createMapCameraPosition,
  createMarkerState,
} from '@mapconductor/js-sdk-core';

const tokyo = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });

// Posición de cámara con la semántica de zoom de Google Maps — compartida por todos los proveedores.
const camera = createMapCameraPosition({ position: tokyo, zoom: 12 });

// Estado observable de marcador. Renderízalo con <Marker state={...}> de
// @mapconductor/js-sdk-react en cualquier proveedor; las mutaciones actualizan la vista.
const marker = createMarkerState({ id: 'tokyo', position: tokyo });
```

Consulta los README de los paquetes `react-for-*` para ver ejemplos completos de mapas.

## Qué incluye

- Utilidades de geometría y geometría esférica: `GeoPoint`, límites, desplazamientos, proyecciones
- Cámara: `MapCameraPosition` con la semántica de zoom de Google Maps, más la conversión zoom/altitud compartida por los paquetes de proveedor
- Estados observables de superposiciones: marcador, círculo, polilínea, polígono, imagen de suelo y capa ráster
- Teselado de marcadores masivos (`MarkerTilingOptions`) y helpers de geoceldas
- Infraestructura de servidor de teselas local (incluido el punto de entrada de service worker `tile-sw.js`)
- Interfaces de controlador y proveedor implementadas por cada paquete `react-for-*`

## Notas de desarrollo

La lógica de este paquete debe mantenerse sincronizada con el módulo core del SDK de Android de MapConductor.

## Paquetes relacionados

- [`@mapconductor/js-sdk-react`](../js-sdk-react) — `Marker`, `Markers`, formas y burbujas de información compartidos
- `@mapconductor/react-for-*` — paquetes de proveedor (Google Maps, MapLibre, Mapbox, Leaflet, OpenLayers, ArcGIS, Cesium, HERE)
