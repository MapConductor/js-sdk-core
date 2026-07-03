import { MarkerEntity } from "./MarkerEntity";
import { MarkerState } from "./MarkerState";
import { OnMarkerEventHandler } from "./OnMarkerEventHandler";

export interface BitmapIcon {
    url: string;
    anchor: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
}

export interface AddParams {
    state: MarkerState;
    bitmapIcon: BitmapIcon;
}

export interface ChangeParams<ActualMarker> {
    current: MarkerEntity<ActualMarker>
    bitmapIcon: BitmapIcon
    prev: MarkerEntity<ActualMarker>
}

export interface MarkerOverlayRenderer<ActualMarker> {
    animateStartListener: OnMarkerEventHandler | null;
    animateEndListener: OnMarkerEventHandler | null;

    onAdd(data: AddParams[]): Promise<(ActualMarker | null)[]>

    onChange(data: ChangeParams<ActualMarker>[]) : Promise<(ActualMarker | null)[]>

    onRemove(data: MarkerEntity<ActualMarker>[]): Promise<void>

    onAnimate(entity: MarkerEntity<ActualMarker>): Promise<void>

    onPostProcess(): Promise<void>
}
