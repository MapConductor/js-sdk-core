import { MarkerFingerPrint } from "./MarkerFingerPrint";
import { MarkerState } from "./MarkerState";

export interface MarkerEntity<ActualMarker> {
    marker: ActualMarker | null;
    state: MarkerState;
    fingerPrint: MarkerFingerPrint;
    visible: boolean;
    isRendered: boolean;
    /**
     * タイル描画されるマーカーかどうか。
     *
     * android-sdk / ios-sdk の `MarkerEntity.tiling` に対応する。以前は「タイル済み」を
     * `marker === null` で表現していたが、それだとプロバイダの `onAdd` が失敗して null を
     * 返したエンティティまでタイル扱いになってしまうため、明示的なフラグを持つ。
     */
    tiling: boolean;
}

export const createMarkerEntity = <ActualMarker>(params: {
    marker: ActualMarker | null,
    state: MarkerState,
    visible?: boolean,
    isRendered?: boolean,
    tiling?: boolean,
}) : MarkerEntity<ActualMarker> => {
    return {
        marker: params.marker,
        state: params.state,
        visible: params.visible ?? true,
        isRendered: params.isRendered ?? false,
        tiling: params.tiling ?? false,
        fingerPrint: params.state.fingerPrint(),
    };
}
