import { GeoPoint } from "../features";
import { combineHash, hashBool, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { Serializable } from "../marker/MarkerState";

export interface PolylineFingerPrint {
    id: number;
    strokeColor: number;
    strokeWidth: number;
    geodesic: number;
    zIndex: number;
    points: number;
    extra: number;
}

export interface PolylineEvent {
    state: PolylineState;
    clicked: GeoPoint;
}

export type OnPolylineEventHandler = (event: PolylineEvent) => void;

export interface PolylineState {
    readonly id: string;
    points: GeoPoint[];
    strokeColor: string;
    strokeWidth: number;
    geodesic: boolean;
    zIndex: number;
    extra: Serializable | null;
    onClick: OnPolylineEventHandler | null;
    fingerPrint(): PolylineFingerPrint;
    copy(opts?: PolylineStateCopyParams): PolylineState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): { subscribe: (fn: (fp: PolylineFingerPrint) => void) => () => void };
}

export interface PolylineStateCopyParams {
    points?: GeoPoint[];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolylineEventHandler | null;
}

function listHashCode(list: GeoPoint[]): number {
    let result = 0;
    for (const p of list) {
        result = (31 * result + (hashNum(p.latitude) ^ hashNum(p.longitude))) | 0;
    }
    return result;
}

function polylineId(hashCodes: number[]): number {
    return hashCodes.reduce((result, hc) => (31 * result + hc) | 0, 0);
}

const fingerPrintEquals = (a: PolylineFingerPrint, b: PolylineFingerPrint): boolean =>
    a.id === b.id &&
    a.strokeColor === b.strokeColor &&
    a.strokeWidth === b.strokeWidth &&
    a.geodesic === b.geodesic &&
    a.zIndex === b.zIndex &&
    a.points === b.points &&
    a.extra === b.extra;

export function createPolylineState(params: {
    points: GeoPoint[];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolylineEventHandler | null;
}): PolylineState {
    let points = params.points;
    let strokeColor = params.strokeColor ?? "#000000";
    let strokeWidth = params.strokeWidth ?? 1;
    let geodesic = params.geodesic ?? false;
    let zIndex = params.zIndex ?? 0;
    let extra = params.extra ?? null;
    let onClick = params.onClick ?? null;

    const id =
        params.id ??
        polylineId([
            listHashCode(points),
            hashObj(strokeColor),
            hashNum(strokeWidth),
            hashBool(geodesic),
            extra == null ? 0 : hashObj(extra),
        ]).toString();

    const subject = createSubject<PolylineFingerPrint>(fingerPrintEquals);
    const emit = () => subject.next(fingerPrint());

    function fingerPrint(): PolylineFingerPrint {
        return {
            id: hashObj(id),
            strokeColor: hashObj(strokeColor),
            strokeWidth: hashNum(strokeWidth),
            geodesic: hashBool(geodesic),
            zIndex,
            points: listHashCode(points),
            extra: extra == null ? 0 : hashObj(extra),
        };
    }

    const hashCode = (): number => {
        let result = extra == null ? 0 : hashObj(extra);
        result = combineHash(result, hashObj(strokeColor));
        result = combineHash(result, hashNum(strokeWidth));
        result = combineHash(result, hashBool(geodesic));
        result = combineHash(result, zIndex);
        result = combineHash(result, listHashCode(points));
        return result | 0;
    };

    const copy = (opts: PolylineStateCopyParams = {}): PolylineState =>
        createPolylineState({
            id: "id" in opts ? opts.id ?? null : id,
            points: opts.points ?? points,
            strokeColor: opts.strokeColor ?? strokeColor,
            strokeWidth: opts.strokeWidth ?? strokeWidth,
            geodesic: opts.geodesic ?? geodesic,
            zIndex: opts.zIndex ?? zIndex,
            extra: "extra" in opts ? opts.extra ?? null : extra,
            onClick: "onClick" in opts ? opts.onClick ?? null : onClick,
        });

    const equals = (other: unknown): boolean => {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && hashCode() === o.hashCode();
    };

    const state: PolylineState = {
        get id() { return id; },
        get points() { return points; },
        set points(v: GeoPoint[]) { points = v; emit(); },
        get strokeColor() { return strokeColor; },
        set strokeColor(v: string) { strokeColor = v; emit(); },
        get strokeWidth() { return strokeWidth; },
        set strokeWidth(v: number) { strokeWidth = v; emit(); },
        get geodesic() { return geodesic; },
        set geodesic(v: boolean) { geodesic = v; emit(); },
        get zIndex() { return zIndex; },
        set zIndex(v: number) { zIndex = v; emit(); },
        get extra() { return extra; },
        set extra(v: Serializable | null) { extra = v; emit(); },
        get onClick() { return onClick; },
        set onClick(v: OnPolylineEventHandler | null) { onClick = v; emit(); },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
