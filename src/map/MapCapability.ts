import type { MapGesture } from '../settings/MapUISettings';

/**
 * プロバイダが対応できる機能の識別子。
 *
 * 型付きの {@link MapServiceKey} が「どう実装するか」を運ぶのに対し、こちらは
 * 「対応しているか」だけを表す安定した ID。アプリ開発者に型キーを触らせずに
 * 対応状況を問い合わせられるようにするために分けてある。
 *
 * 値を持つ capability（例: 穴を何個描けるか）は型付きキーで別途登録すること。
 * ここは真偽ではなく {@link MapCapabilityStatus} の 4 段階で表現する。
 *
 * android-sdk / ios-sdk にも同名・同じ文字列で置く。この文字列は永続化やログに
 * 出るため、変えないこと。
 */
export type MapCapability =
    // オーバーレイ
    | 'marker'
    | 'polyline'
    | 'polygon'
    | 'circle'
    | 'groundImage'
    | 'rasterLayer'
    /** 穴付きポリゴンを描けるか。何個描けるかは別途 {@link MapServiceKey} で値を登録する。 */
    | 'polygonHoles'
    /**
     * オーバーレイをタップに対して透過させられるか。
     *
     * MapConductor は原則としてクリックを地図クリックで受け、コアがヒットテストして
     * 配送する。そのためにはネイティブのオーバーレイがタップを消費しないよう
     * 「透過」に設定できる必要がある。できない SDK ではネイティブのクリック
     * リスナーを使わざるを得ない。
     *
     * この capability が `unsupported` のプロバイダは、ネイティブのクリック
     * リスナー経由でイベントを受ける。判定自体はコアが行うので、アプリから見た
     * 挙動は揃う。
     */
    | 'clickPassthrough'
    // 操作
    | 'markerDrag'
    // カメラ
    | 'cameraTilt'
    | 'cameraRotate'
    | 'cameraRestriction'
    /**
     * 緯度経度と画面座標を **同期的に** 相互変換できるか。
     *
     * InfoBubble・マーカーアニメーション・タイル方式マーカーのヒットテストが
     * これを要求する。
     */
    | 'screenProjectionSync'
    // ジェスチャ（{@link MapGesture} と 1 対 1）
    | 'gestureScroll'
    | 'gestureZoom'
    | 'gestureRotate'
    | 'gestureTilt';

/** 列挙するための一覧。android/iOS の `entries` / `allCases` に対応する。 */
export const MAP_CAPABILITIES: readonly MapCapability[] = [
    'marker',
    'polyline',
    'polygon',
    'circle',
    'groundImage',
    'rasterLayer',
    'polygonHoles',
    'clickPassthrough',
    'markerDrag',
    'cameraTilt',
    'cameraRotate',
    'cameraRestriction',
    'screenProjectionSync',
    'gestureScroll',
    'gestureZoom',
    'gestureRotate',
    'gestureTilt',
] as const;

export function mapCapabilityFromId(id: string): MapCapability | null {
    return (MAP_CAPABILITIES as readonly string[]).includes(id) ? (id as MapCapability) : null;
}

/** {@link MapGesture} に対応する {@link MapCapability}。 */
export function capabilityOfGesture(gesture: MapGesture): MapCapability {
    switch (gesture) {
        case 'scroll':
            return 'gestureScroll';
        case 'zoom':
            return 'gestureZoom';
        case 'rotate':
            return 'gestureRotate';
        case 'tilt':
            return 'gestureTilt';
    }
}

/**
 * ある {@link MapCapability} にプロバイダがどこまで応えられるか。
 *
 * 「未宣言（`unknown`）」と「恒久的に非対応（`unsupported`）」を区別できることが重要。
 * 区別が無いと、地図の初期化が終わっていないだけの状態と、その SDK では原理的に
 * できないことが同じに見えてしまう。
 */
export type MapCapabilityStatus =
    /** 期待どおりに動く。 */
    | { readonly kind: 'supported'; readonly reason?: undefined }
    /** 動くが結果が別物になる。例: HERE の穴付きポリゴンは塗りが和集合になる。 */
    | { readonly kind: 'degraded'; readonly reason: string }
    /** 動くが数値が近似。例: 円を多角形で近似する、ズーム換算に較正誤差がある。 */
    | { readonly kind: 'approximated'; readonly reason: string }
    /** この SDK では実現できない。 */
    | { readonly kind: 'unsupported'; readonly reason: string }
    /**
     * まだ宣言されていない。初期化途中か、プロバイダが宣言を書いていないかのどちらか。
     *
     * **`unsupported` と同じに扱わないこと。** 非対応と断定してよいのは
     * `unsupported` のときだけ。
     */
    | { readonly kind: 'unknown'; readonly reason?: undefined };

export const MapCapabilityStatus = {
    supported: { kind: 'supported' } as MapCapabilityStatus,
    unknown: { kind: 'unknown' } as MapCapabilityStatus,
    degraded: (reason: string): MapCapabilityStatus => ({ kind: 'degraded', reason }),
    approximated: (reason: string): MapCapabilityStatus => ({ kind: 'approximated', reason }),
    unsupported: (reason: string): MapCapabilityStatus => ({ kind: 'unsupported', reason }),
} as const;

/** 完全に期待どおりか（`supported` のみ true）。 */
export function isFullySupported(status: MapCapabilityStatus): boolean {
    return status.kind === 'supported';
}

/** 何らかの形で機能するか（`degraded` / `approximated` を含む）。 */
export function isUsable(status: MapCapabilityStatus): boolean {
    return status.kind === 'supported' || status.kind === 'degraded' || status.kind === 'approximated';
}

/** 宣言されていて、かつ使えないと分かっているか。 */
export function isKnownUnsupported(status: MapCapabilityStatus): boolean {
    return status.kind === 'unsupported';
}
