import { GeoPoint } from "../features";
import { MapCameraPosition } from "../types";

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
