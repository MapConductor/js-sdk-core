[English](./README.md) | 日本語 | [Español (Latinoamérica)](./README.es-419.md)

# @mapconductor/js-sdk-core

MapConductor JS SDK のコア抽象レイヤーです。ジオメトリ、カメラ、オブザーバブルなマップ/オーバーレイ状態、コントローラインターフェース、共有型を提供します。React や DOM に依存しないプラットフォーム中立なパッケージで、`@mapconductor/js-sdk-react` とすべてのプロバイダパッケージ(`react-for-googlemaps`、`react-for-maplibre`、`react-for-here` など)がこの上に構築されています。

## インストール

いずれかのプロバイダパッケージをインストールすれば自動的に含まれます。このパッケージから直接 import する場合(通常のアプリケーションコードは該当します)、pnpm の strict(isolated)な `node_modules` を使う場合、独自のプロバイダや拡張を作る場合は、明示的にインストールしてください:

```shell
npm install @mapconductor/js-sdk-core
```

## クイックスタート

アプリケーションコードはここでプロバイダ中立な状態を作り、任意のプロバイダビューに渡します:

```ts
import {
  createGeoPoint,
  createMapCameraPosition,
  createMarkerState,
} from '@mapconductor/js-sdk-core';

const tokyo = createGeoPoint({ latitude: 35.6812, longitude: 139.7671 });

// Google Maps のズームセマンティクスによるカメラ位置 — 全プロバイダで共通です。
const camera = createMapCameraPosition({ position: tokyo, zoom: 12 });

// オブザーバブルなマーカー状態。@mapconductor/js-sdk-react の
// <Marker state={...}> で任意のプロバイダに描画でき、変更はビューに反映されます。
const marker = createMarkerState({ id: 'tokyo', position: tokyo });
```

地図全体のサンプルは各 `react-for-*` パッケージの README を参照してください。

## 提供機能

- ジオメトリ・球面幾何ユーティリティ: `GeoPoint`、境界、オフセット、投影
- カメラ: Google Maps ズームセマンティクスの `MapCameraPosition` と、プロバイダパッケージで共有されるズーム/高度変換
- オブザーバブルなオーバーレイ状態: マーカー、サークル、ポリライン、ポリゴン、グラウンドイメージ、ラスターレイヤー
- 大量マーカーのタイリング(`MarkerTilingOptions`)とジオセルヘルパー
- ローカルタイルサーバー基盤(`tile-sw.js` サービスワーカーのエントリポイントを含む)
- 各 `react-for-*` パッケージが実装するコントローラ/プロバイダのインターフェース

## 開発メモ

このパッケージのロジックは MapConductor Android SDK のコアモジュールと同期を保つ必要があります。

## 関連パッケージ

- [`@mapconductor/js-sdk-react`](../js-sdk-react) — 共有の `Marker`・`Markers`・シェイプ・インフォバブル
- `@mapconductor/react-for-*` — プロバイダパッケージ(Google Maps、MapLibre、Mapbox、Leaflet、OpenLayers、ArcGIS、Cesium、HERE)
