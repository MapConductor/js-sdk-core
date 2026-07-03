import { GeoPoint } from "../features";
import { combineHash, hashBool, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";

import { Serializable } from "../marker/MarkerState";

export interface CircleFingerPrint {
    id: number;
    center: number;
    radiusMeters: number;
    clickable: number;
    geodesic: number;
    strokeColor: number;
    strokeWidth: number;
    fillColor: number;
    zIndex: number;
    extra: number;
}

export interface CircleEvent {
    state: CircleState;
    clicked: GeoPoint;
}

export type OnCircleEventHandler = (event: CircleEvent) => void;

export interface CircleState {
    readonly id: string;
    center: GeoPoint;
    radiusMeters: number;
    geodesic: boolean;
    clickable: boolean;
    strokeColor: string;
    strokeWidth: number;
    fillColor: string;
    extra: Serializable | null;
    zIndex: number | null;
    onClick: OnCircleEventHandler | null;
    fingerPrint(): CircleFingerPrint;
    copy(opts?: CircleStateCopyParams): CircleState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): { subscribe: (fn: (fp: CircleFingerPrint) => void) => () => void };
}

export interface CircleStateCopyParams {
    center?: GeoPoint;
    radiusMeters?: number;
    geodesic?: boolean;
    clickable?: boolean;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    extra?: Serializable | null;
    zIndex?: number | null;
    onClick?: OnCircleEventHandler | null;
    id?: string | null;
}

const fingerPrintEquals = (a: CircleFingerPrint, b: CircleFingerPrint): boolean =>
    a.id === b.id &&
    a.center === b.center &&
    a.radiusMeters === b.radiusMeters &&
    a.clickable === b.clickable &&
    a.geodesic === b.geodesic &&
    a.strokeColor === b.strokeColor &&
    a.strokeWidth === b.strokeWidth &&
    a.fillColor === b.fillColor &&
    a.zIndex === b.zIndex &&
    a.extra === b.extra;

function circleId(hashCodes: number[]): number {
    return hashCodes.reduce((result, hc) => (31 * result + hc) | 0, 0);
}

export function createCircleState(params: {
    center: GeoPoint;
    radiusMeters: number;
    geodesic?: boolean;
    clickable?: boolean;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    extra?: Serializable | null;
    zIndex?: number | null;
    onClick?: OnCircleEventHandler | null;
    id?: string | null;
}): CircleState {
    let center = params.center;
    let radiusMeters = params.radiusMeters;
    let geodesic = params.geodesic ?? true;
    let clickable = params.clickable ?? true;
    let strokeColor = params.strokeColor ?? "#FF0000";
    let strokeWidth = params.strokeWidth ?? 1;
    let fillColor = params.fillColor ?? "rgba(255,255,255,0.5)";
    let extra = params.extra ?? null;
    let zIndex = params.zIndex ?? null;
    let onClick = params.onClick ?? null;

    const id =
        params.id ??
        circleId([
            hashNum(center.latitude) ^ hashNum(center.longitude),
            hashNum(radiusMeters),
            hashBool(clickable),
            hashBool(geodesic),
            extra == null ? 0 : hashObj(extra),
            hashObj(strokeColor),
            hashNum(strokeWidth),
            hashObj(fillColor),
            zIndex == null ? 0 : zIndex,
        ]).toString();

    const subject = createSubject<CircleFingerPrint>(fingerPrintEquals);

    const emit = () => subject.next(fingerPrint());

    function fingerPrint(): CircleFingerPrint {
        return {
            id: hashObj(id),
            center: hashNum(center.latitude) ^ hashNum(center.longitude),
            radiusMeters: hashNum(radiusMeters),
            clickable: hashBool(clickable),
            geodesic: hashBool(geodesic),
            strokeColor: hashObj(strokeColor),
            strokeWidth: hashNum(strokeWidth),
            fillColor: hashObj(fillColor),
            zIndex: zIndex == null ? 0 : zIndex,
            extra: extra == null ? 0 : hashObj(extra),
        };
    }

    const hashCode = (): number => {
        let result = extra == null ? 0 : hashObj(extra);
        result = combineHash(result, hashNum(center.latitude));
        result = combineHash(result, hashNum(center.longitude));
        result = combineHash(result, hashBool(clickable));
        result = combineHash(result, hashBool(geodesic));
        result = combineHash(result, hashNum(radiusMeters));
        result = combineHash(result, hashObj(strokeColor));
        result = combineHash(result, hashNum(strokeWidth));
        result = combineHash(result, hashObj(fillColor));
        result = combineHash(result, zIndex == null ? 0 : zIndex);
        return result | 0;
    };

    const copy = (opts: CircleStateCopyParams = {}): CircleState =>
        createCircleState({
            id: "id" in opts ? opts.id ?? null : id,
            center: opts.center ?? center,
            radiusMeters: opts.radiusMeters ?? radiusMeters,
            geodesic: opts.geodesic ?? geodesic,
            clickable: opts.clickable ?? clickable,
            strokeColor: opts.strokeColor ?? strokeColor,
            strokeWidth: opts.strokeWidth ?? strokeWidth,
            fillColor: opts.fillColor ?? fillColor,
            extra: "extra" in opts ? opts.extra ?? null : extra,
            zIndex: "zIndex" in opts ? opts.zIndex ?? null : zIndex,
            onClick: "onClick" in opts ? opts.onClick ?? null : onClick,
        });

    const equals = (other: unknown): boolean => {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && hashCode() === o.hashCode();
    };

    const state: CircleState = {
        get id() { return id; },
        get center() { return center; },
        set center(v: GeoPoint) { center = v; emit(); },
        get radiusMeters() { return radiusMeters; },
        set radiusMeters(v: number) { radiusMeters = v; emit(); },
        get geodesic() { return geodesic; },
        set geodesic(v: boolean) { geodesic = v; emit(); },
        get clickable() { return clickable; },
        set clickable(v: boolean) { clickable = v; emit(); },
        get strokeColor() { return strokeColor; },
        set strokeColor(v: string) { strokeColor = v; emit(); },
        get strokeWidth() { return strokeWidth; },
        set strokeWidth(v: number) { strokeWidth = v; emit(); },
        get fillColor() { return fillColor; },
        set fillColor(v: string) { fillColor = v; emit(); },
        get extra() { return extra; },
        set extra(v: Serializable | null) { extra = v; emit(); },
        get zIndex() { return zIndex; },
        set zIndex(v: number | null) { zIndex = v; emit(); },
        get onClick() { return onClick; },
        set onClick(v: OnCircleEventHandler | null) { onClick = v; emit(); },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
