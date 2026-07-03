import { GeoPoint } from "../features";
import { hashBool, hashNum, hashObj, hashStr } from "../features/hash-utils";
import { MarkerAnimation } from "./MarkerAnimation";
import { MarkerIcon } from "./MarkerIcon";

export interface MarkerFingerPrint {
    id: number;
    icon: number;
    clickable: number;
    draggable: number;
    latitude: number;
    longitude: number;
    animation: number;
    zIndex: number;
}

type Hashable = {
    hashCode?: () => number;
};

type MarkerFingerPrintState = {
    id: string;
    icon: MarkerIcon | null;
    clickable: boolean;
    draggable: boolean;
    position: GeoPoint;
    zIndex: number;
    getAnimation(): MarkerAnimation | null;
};

export function markerIconHashCode(icon: MarkerIcon | null): number {
    if (!icon) return 0;
    const hashCode = (icon as MarkerIcon & Hashable).hashCode;
    return typeof hashCode === "function" ? hashCode.call(icon) : hashObj(icon);
}

function hashAnimation(animation: MarkerAnimation | null): number {
    if (!animation) return 1;
    const hashCode = (animation as unknown as Hashable).hashCode;
    return typeof hashCode === "function" ? hashCode.call(animation) : hashStr(String(animation));
}

export const createFingerPrint = (state: MarkerFingerPrintState): MarkerFingerPrint => {
    const animation = state.getAnimation();
    return {
        id: hashStr(state.id),
        icon: markerIconHashCode(state.icon),
        clickable: hashBool(state.clickable),
        draggable: hashBool(state.draggable),
        latitude: hashNum(state.position.latitude),
        longitude: hashNum(state.position.longitude),
        animation: hashAnimation(animation),
        zIndex: state.zIndex,
    };
};

export function createMarkerFingerPrint(state: MarkerFingerPrintState): MarkerFingerPrint;
export function createMarkerFingerPrint(params: {
    id: string;
    icon: MarkerIcon | null;
    clickable: boolean;
    draggable: boolean;
    position: GeoPoint;
    animation: MarkerAnimation | null;
    zIndex?: number;
}): MarkerFingerPrint;
export function createMarkerFingerPrint(params: MarkerFingerPrintState | {
    id: string;
    icon: MarkerIcon | null;
    clickable: boolean;
    draggable: boolean;
    position: GeoPoint;
    animation: MarkerAnimation | null;
    zIndex?: number;
}): MarkerFingerPrint {
    if ("getAnimation" in params) {
        return createFingerPrint(params);
    }

    return createFingerPrint({
        id: params.id,
        icon: params.icon,
        clickable: params.clickable,
        draggable: params.draggable,
        position: params.position,
        zIndex: params.zIndex ?? 0,
        getAnimation: () => params.animation,
    });
}
