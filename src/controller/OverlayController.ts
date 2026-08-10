import { GeoPoint, type GeoPointInterface } from "../features";
import { MapCameraPosition } from "../types";
import type { OverlayHit } from "./OverlayHitResolver";
import type { OverlayKind } from "./OverlayKind";

/**
 * `BaseMapViewController` のオーバーレイレジストリが必要とする最小の構造。
 *
 * `OverlayController` は状態/エンティティ/イベントの3型でパラメータ化されているため、
 * 異なるオーバーレイ種別を1つの配列に入れられない。android-sdk の
 * `OverlayControllerInterface<*, *>` によるスター射影に相当するものとして、
 * レジストリが実際に呼ぶメンバだけを非ジェネリックに切り出す。
 */
export interface OverlayControllerLike {
    onCameraChanged?(mapCameraPosition: MapCameraPosition): Promise<void> | void;
    destroy?(): void;

    // ── スロット参加分（{@link SlottedOverlayController} を参照） ──────────
    //
    // ここでは省略可能にしてある。カメラ購読のためだけに登録する拡張モジュール
    // （heatmap など）はスロットに参加しないため。
    //
    // **スロットに参加するコントローラは `implements SlottedOverlayController` と
    // 明示的に書くこと。** そう書いてあれば、メンバの書き忘れが型エラーになる。
    // 構造的部分型なので、書かなければ何も守ってくれない。
    readonly kind?: OverlayKind;
    hasId?(id: string): boolean;
    compositionAny?(data: unknown[]): Promise<void>;
    updateAny?(state: unknown): Promise<void>;
    setClickListenerAny?(listener: unknown): void;
    resolveTap?(position: GeoPointInterface): OverlayHit | null;
}

export interface OverlayController<StateType, EntityType, EventType> {
    readonly zIndex: number;
    clickListener: ((event: EventType) => void) | null

    add(data: StateType[]): Promise<void>
    update(state: StateType): Promise<void>
    clear(): Promise<void>
    find(position: GeoPoint) : EntityType | null
    onCameraChanged(mapCameraPosition: MapCameraPosition) : Promise<void> | void

    /**
     * Cleanup resources when the controller is no longer needed.
     * IMPORTANT: Call this when switching map providers or disposing the map.
     */
    destroy() : void
}

/**
 * Capable ファサードのスロットに参加するオーバーレイコントローラ。
 *
 * {@link BaseMapViewController} の `compositionXxx` / `updateXxx` / `hasXxx` の既定実装は、
 * 登録済みコントローラのうちこれを満たすものだけを {@link kind} で振り分ける。
 *
 * ## なぜ {@link OverlayControllerLike} に省略可能で置かないか
 *
 * `kind?: OverlayKind` にすると**宣言を忘れてもコンパイルが通り**、
 * `primaryOverlayController(kind)` が null を返して追加が黙って捨てられる。
 * android-sdk では実際に、マーカーコントローラへの宣言忘れで全プロバイダの
 * マーカーが一切表示されない状態を作り込んだ。ビルドも型検査も既存テストも緑のまま
 * すり抜ける類の不具合なので、**必須メンバ**にして宣言忘れを型エラーにする。
 *
 * カメラ購読のためだけに登録する拡張モジュール（heatmap など）はこれを満たさないので、
 * スロットに巻き込まれない。
 *
 * @internal ドライバー実装点。アプリからは使わない。
 */
export interface SlottedOverlayController {
    readonly kind: OverlayKind;

    /** この id のオーバーレイを保持しているか。`hasXxx` の既定実装が使う。 */
    hasId(id: string): boolean;

    /** 型を消した状態の追加。`compositionXxx` の既定実装が使う。 */
    compositionAny(data: unknown[]): Promise<void>;

    /** 型を消した状態の更新。`updateXxx` の既定実装が使う。 */
    updateAny(state: unknown): Promise<void>;

    /**
     * 非推奨の `setOnXxxClickListener` から呼ばれる、型を消したクリックリスナー設定。
     * 型付きの `clickListener` を持つコアのコントローラだけが意味のある実装を持つ。
     */
    setClickListenerAny(listener: unknown): void;

    /**
     * タップの当たり判定と、当たったときの配送手段。当たらなければ null。
     *
     * クリックカスケード（{@link OverlayHitResolver}）の 1 段。解決するだけで配送はしない
     * （呼び出し側が `OverlayHit.dispatch()` を呼ぶまで副作用は起きない）。
     *
     * ## これも `kind` と同じく**必須メンバ**にしてある
     *
     * 省略可能にすると、実装を忘れたコントローラが「タップに反応しないが、
     * ビルドも型検査も通る」状態になる。android-for-maplibre / mapbox のポリゴンが
     * 実際にそれで、カスケードからも `hasPolygon` からも黙って漏れていた。
     *
     * クリックを持たない種別は明示的に null を返すこと（ラスターレイヤ）。
     * マーカーは判定に画面投影が要るため別経路
     * （`BaseMapViewController.dispatchMarkerTap`）で、ここでは null を返す。
     */
    resolveTap(position: GeoPointInterface): OverlayHit | null;
}

/** 登録済みコントローラが {@link SlottedOverlayController} を満たすか。 */
export function isSlottedOverlayController(
    controller: OverlayControllerLike,
): controller is OverlayControllerLike & SlottedOverlayController {
    const candidate = controller as Partial<SlottedOverlayController>;
    return (
        typeof candidate.kind === 'string' &&
        typeof candidate.hasId === 'function' &&
        typeof candidate.compositionAny === 'function' &&
        typeof candidate.updateAny === 'function'
    );
}
