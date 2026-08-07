import type { GeoRectBounds } from '../features/GeoRectBounds';
import type { CameraRestriction } from '../map/CameraRestriction';
import type { MapViewHolder } from '../map/MapViewHolder';
import type { OverlayControllerLike } from './OverlayController';
import type { OnCameraMoveHandler, OnMapEventHandler } from '../map/MapViewBase';
import type { MapUISettings } from '../settings/MapUISettings';
import type { MapCameraPosition } from '../types/MapCamera';

// Matches Android: typealias OnMapInitializedHandler = () -> Unit
export type OnMapInitializedHandler = () => void;

/**
 * Core controller interface that all map SDK modules must implement.
 * Mirrors Android MapViewControllerInterface / iOS MapViewControllerProtocol.
 */
export interface MapViewControllerInterface {
  readonly holder: MapViewHolder<unknown, unknown>;

  clearOverlays(): Promise<void>;

  setCameraMoveStartListener(listener: OnCameraMoveHandler | null): void;
  setCameraMoveListener(listener: OnCameraMoveHandler | null): void;
  setCameraMoveEndListener(listener: OnCameraMoveHandler | null): void;
  setMapClickListener(listener: OnMapEventHandler | null): void;
  setMapLongClickListener(listener: OnMapEventHandler | null): void;
  setMapInitializedListener(listener: OnMapInitializedHandler | null): void;

  moveCamera(position: MapCameraPosition): Promise<boolean>;

  /**
   * カメラをアニメーションで移動する。
   *
   * 引数は android-sdk の `animateCamera(position, duration: Long)` に揃えてある。
   * 以前は `CameraOptions` を受けていたが、実際に読まれていたのは `duration` だけで、
   * `easing` はどのプロバイダも見ておらず、`paddings` は `padding` の別名として
   * フォールバックされるだけだった。
   *
   * 戻り値が `Promise` なのは Kotlin の `Unit` / Swift の `Void` に対する TS 側の
   * 言い方の違いで、`clearOverlays()` が `suspend fun` に対して `Promise<void>` なのと同じ。
   */
  animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;

  /**
   * Applies the gesture flags to the underlying map engine.
   *
   * Optional the same way Android's `applyUISettings` has an empty default body:
   * a provider that has not been wired up yet simply leaves the map as it is.
   */
  applyUISettings?(settings: MapUISettings): void;

  /**
   * カメラの可動範囲（パン範囲・ズーム上下限）を制限する。null または空の
   * `CameraRestriction` で制限解除。
   *
   * ネイティブに範囲制限 API を持つプロバイダは直接適用し、持たないプロバイダは
   * `BaseMapViewController.cameraRestrictionCorrection()` によるクランプで実現する。
   * ズームは統一ズーム（Google 準拠）で指定し、各プロバイダが自身の体系へ変換する。
   *
   * `applyUISettings` と同じく optional: 未対応のプロバイダはマップをそのままにする。
   */
  setCameraRestriction?(restriction: CameraRestriction | null): void;

  /**
   * オーバーレイコントローラを登録する。登録先にはカメラ変更が伝播し、`destroy()` で
   * 一括破棄される。`BaseMapViewController` が実装を提供する。
   */
  registerOverlayController?(controller: OverlayControllerLike): void;

  /** 登録を解除する。`BaseMapViewController` が実装を提供する。 */
  unregisterOverlayController?(controller: OverlayControllerLike): void;

  /**
   * 範囲が収まるようにカメラを合わせる。
   * 引数は android-sdk の `fitBounds(bounds, padding: Int)` に揃えてある。
   */
  fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;

  // Web-specific (not in Android/iOS interface, but universally needed on web)
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ getCameraPosition() / getBounds() をここに足さないこと。              │
  // │ DO NOT add a camera getter to this interface.                        │
  // └──────────────────────────────────────────────────────────────────────┘
  //
  // 一度あって、2026-08-06 に外した。同じ提案が繰り返し出るので理由を残す。
  // 解説ページ: /docs/reading-camera
  //
  // 1. 宣言的 UI（Compose / SwiftUI / React）では、状態の出どころは 1 つにする。
  //    カメラは状態なので置き場所は state。ここに getter を足すと state と
  //    SDK 直読みの 2 系統になり、ズレる余地だけが増える。
  //
  // 2. push 型で設計されている。地図 SDK のカメライベント → プロバイダが生値を
  //    統一ズームへ変換し visibleRegion を載せる → state.updateCameraPosition()
  //    → `mapViewState.cameraPosition` / `onCameraMove` / `onCameraMoveEnd` /
  //    登録済みオーバーレイの `onCameraChanged`。取りに行く必要がない。
  //
  // 3. pull は安くない。1 回の呼び出しで画面 4 隅の逆投影をして visibleRegion を
  //    組み立てる。単なるゲッターではない。
  //
  // 4. 実測（MapLibre マーカーページ / Chromium / 1 ドラッグ＝約 20 フレーム）:
  //        getter あり: 初期ロード 5 回・静止 3 秒 0 回・1 ドラッグ 86 回
  //        getter なし: 初期ロード 3 回・              1 ドラッグ 30 回
  //    減った 56 回はすべて「直前に push したのと同じ値の作り直し」だった
  //    （13 のビューが毎レンダー呼んでいた）。操作中だけ効くコストなので、
  //    地図がいちばん重い瞬間に上乗せされる。
  //
  // 5. state は「最後に push された値」なので理屈のうえでは 1 フレーム古いが、
  //    `onCameraMove` は移動中も毎フレーム発火するため体感差はない。
  //    外したあとも 41 件のブラウザテストがそのまま通っている。
  //
  // SDK の描画ループに同期したい等で生値がどうしても要る場合は、この抽象を
  // 迂回せず `mapViewState.getMapViewHolder()` からネイティブの地図を取ること。
  //
  // 各プロバイダは内部に `getCameraPosition()` を持っているが、それはカメライベントに
  // 載せる値を組み立てるための実装であり、インタフェースには出さない
  // （android-sdk は private な getMapCameraPosition()、
  //   ios-sdk は private な currentCameraPosition(from:) と同じ位置づけ）。
  destroy(): void;
}
