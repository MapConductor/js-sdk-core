import { GeoPoint } from "../features";
import { combineHash, hashBool, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { Serializable } from "../marker";

export interface PolygonFingerPrint {
    id: number;
    strokeColor: number;
    strokeWidth: number;
    fillColor: number;
    geodesic: number;
    zIndex: number;
    points: number;
    holes: number;
    extra: number;
}

export interface PolygonEvent {
    state: PolygonState;
    clicked: GeoPoint;
}

export type OnPolygonEventHandler = (event: PolygonEvent) => void;

export interface PolygonState {
    readonly id: string;
    points: GeoPoint[];
    holes: GeoPoint[][];
    strokeColor: string;
    strokeWidth: number;
    fillColor: string;
    geodesic: boolean;
    zIndex: number;
    extra: Serializable | null;
    onClick: OnPolygonEventHandler | null;
    fingerPrint(): PolygonFingerPrint;
    copy(opts?: PolygonStateCopyParams): PolygonState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): { subscribe: (fn: (fp: PolygonFingerPrint) => void) => () => void };
}

export interface PolygonStateCopyParams {
    points?: GeoPoint[];
    holes?: GeoPoint[][];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolygonEventHandler | null;
}

function listHashCode(list: GeoPoint[]): number {
    let result = 0;
    for (const p of list) {
        result = (31 * result + (hashNum(p.latitude) ^ hashNum(p.longitude))) | 0;
    }
    return result;
}

function nestedListHashCode(list: GeoPoint[][]): number {
    let result = 0;
    for (const inner of list) {
        result = (31 * result + listHashCode(inner)) | 0;
    }
    return result;
}

function polygonId(hashCodes: number[]): number {
    return hashCodes.reduce((result, hc) => (31 * result + hc) | 0, 0);
}

const fingerPrintEquals = (a: PolygonFingerPrint, b: PolygonFingerPrint): boolean =>
    a.id === b.id &&
    a.strokeColor === b.strokeColor &&
    a.strokeWidth === b.strokeWidth &&
    a.fillColor === b.fillColor &&
    a.geodesic === b.geodesic &&
    a.zIndex === b.zIndex &&
    a.points === b.points &&
    a.holes === b.holes &&
    a.extra === b.extra;

export function createPolygonState(params: {
    points: GeoPoint[];
    holes?: GeoPoint[][];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    geodesic?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolygonEventHandler | null;
}): PolygonState {
    let points = params.points;
    let holes = params.holes ?? [];
    let strokeColor = params.strokeColor ?? "#000000";
    let strokeWidth = params.strokeWidth ?? 2;
    let fillColor = params.fillColor ?? "transparent";
    let geodesic = params.geodesic ?? false;
    let zIndex = params.zIndex ?? 0;
    let extra = params.extra ?? null;
    let onClick = params.onClick ?? null;

    const id =
        params.id ??
        polygonId([
            listHashCode(points),
            nestedListHashCode(holes),
            hashObj(strokeColor),
            hashNum(strokeWidth),
            hashObj(fillColor),
            hashBool(geodesic),
            extra == null ? 0 : hashObj(extra),
        ]).toString();

    const subject = createSubject<PolygonFingerPrint>(fingerPrintEquals);
    const emit = () => subject.next(fingerPrint());

    function fingerPrint(): PolygonFingerPrint {
        return {
            id: hashObj(id),
            strokeColor: hashObj(strokeColor),
            strokeWidth: hashNum(strokeWidth),
            fillColor: hashObj(fillColor),
            geodesic: hashBool(geodesic),
            zIndex,
            points: listHashCode(points),
            holes: nestedListHashCode(holes),
            extra: extra == null ? 0 : hashObj(extra),
        };
    }

    const hashCode = (): number => {
        let result = extra == null ? 0 : hashObj(extra);
        result = combineHash(result, hashObj(strokeColor));
        result = combineHash(result, hashNum(strokeWidth));
        result = combineHash(result, hashObj(fillColor));
        result = combineHash(result, hashBool(geodesic));
        result = combineHash(result, zIndex);
        result = combineHash(result, listHashCode(points));
        result = combineHash(result, nestedListHashCode(holes));
        return result | 0;
    };

    const copy = (opts: PolygonStateCopyParams = {}): PolygonState =>
        createPolygonState({
            id: "id" in opts ? opts.id ?? null : id,
            points: opts.points ?? points,
            holes: opts.holes ?? holes,
            strokeColor: opts.strokeColor ?? strokeColor,
            strokeWidth: opts.strokeWidth ?? strokeWidth,
            fillColor: opts.fillColor ?? fillColor,
            geodesic: opts.geodesic ?? geodesic,
            zIndex: opts.zIndex ?? zIndex,
            extra: "extra" in opts ? opts.extra ?? null : extra,
            onClick: "onClick" in opts ? opts.onClick ?? null : onClick,
        });

    const equals = (other: unknown): boolean => {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && hashCode() === o.hashCode();
    };

    const state: PolygonState = {
        get id() { return id; },
        get points() { return points; },
        set points(v: GeoPoint[]) { points = v; emit(); },
        get holes() { return holes; },
        set holes(v: GeoPoint[][]) { holes = v; emit(); },
        get strokeColor() { return strokeColor; },
        set strokeColor(v: string) { strokeColor = v; emit(); },
        get strokeWidth() { return strokeWidth; },
        set strokeWidth(v: number) { strokeWidth = v; emit(); },
        get fillColor() { return fillColor; },
        set fillColor(v: string) { fillColor = v; emit(); },
        get geodesic() { return geodesic; },
        set geodesic(v: boolean) { geodesic = v; emit(); },
        get zIndex() { return zIndex; },
        set zIndex(v: number) { zIndex = v; emit(); },
        get extra() { return extra; },
        set extra(v: Serializable | null) { extra = v; emit(); },
        get onClick() { return onClick; },
        set onClick(v: OnPolygonEventHandler | null) { onClick = v; emit(); },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
