import { GeoPoint } from "../features";
import { combineHash, hashBool, hashGeoPoint, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { Serializable } from "../marker/MarkerState";

export interface PolylineFingerPrint {
    id: number;
    strokeColor: number;
    strokeWidth: number;
    geodesic: number;
    clickable: number;
    zIndex: number;
    points: number;
    extra: number;
}

export interface PolylineEvent {
    state: PolylineState;
    clicked: GeoPoint;
}

export type OnPolylineEventHandler = (event: PolylineEvent) => void;

/** Receives the state whose overlay was just added to the map. See `PolylineState.onAdded`. */
export type OnPolylineAddedHandler = (state: PolylineState) => void;

export interface PolylineState {
    readonly id: string;
    points: GeoPoint[];
    strokeColor: string;
    strokeWidth: number;
    geodesic: boolean;
    /**
     * タップを受け取るか。`false` ならこのポリラインはタップに対して透過し、
     * 下のオーバーレイ（無ければ地図クリック）へイベントが流れる。
     *
     * 判定はコアの `PolylineManager.find` が行うため、どのプロバイダでも同じ挙動になる。
     * fingerPrint に含めるのは、Google Maps のようにネイティブ側の `clickable` へ
     * 渡すプロバイダがあるため（CircleState と同じ）。
     */
    clickable: boolean;
    zIndex: number;
    extra: Serializable | null;
    onClick: OnPolylineEventHandler | null;
    /**
     * Called once each time this overlay goes from not being on the map to being on it:
     * after the map SDK's object for it has been created, or, when it is drawn in tiles,
     * after the URL template of those tiles has been handed to the map as a raster layer
     * (the tile images may still be loading then). Not called for an in-place change,
     * nor when it moves between native drawing and tiles while staying on the map;
     * called again if it is removed and added again. Clearing or destroying the map calls
     * nothing. Runs after the add has finished, never from inside the drawing code.
     *
     * Like `onClick`, it is not part of the id, fingerprint, equality or hash: replacing
     * it redraws nothing.
     */
    onAdded: OnPolylineAddedHandler | null;
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
    clickable?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolylineEventHandler | null;
    onAdded?: OnPolylineAddedHandler | null;
}

function listHashCode(list: GeoPoint[]): number {
    let result = 0;
    for (const p of list) {
        // android-sdk / ios-sdk と一致: 各点の GeoPoint.hashCode（lat/lng/altitude を
        // fold して *31 畳み込み）を使う。以前の lat^lng（XOR・altitude 無視）から変更。
        result = (31 * result + hashGeoPoint(p)) | 0;
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
    a.clickable === b.clickable &&
    a.zIndex === b.zIndex &&
    a.points === b.points &&
    a.extra === b.extra;

export function createPolylineState(params: {
    points: GeoPoint[];
    id?: string | null;
    strokeColor?: string;
    strokeWidth?: number;
    geodesic?: boolean;
    clickable?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolylineEventHandler | null;
    onAdded?: OnPolylineAddedHandler | null;
}): PolylineState {
    let points = params.points;
    let strokeColor = params.strokeColor ?? "#000000";
    let strokeWidth = params.strokeWidth ?? 1;
    let geodesic = params.geodesic ?? false;
    let clickable = params.clickable ?? true;
    let zIndex = params.zIndex ?? 0;
    let extra = params.extra ?? null;
    let onClick = params.onClick ?? null;
    let onAdded = params.onAdded ?? null;

    const id =
        params.id ??
        polylineId([
            listHashCode(points),
            hashObj(strokeColor),
            hashNum(strokeWidth),
            hashBool(geodesic),
            hashBool(clickable),
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
            clickable: hashBool(clickable),
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
        result = combineHash(result, hashBool(clickable));
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
            clickable: opts.clickable ?? clickable,
            zIndex: opts.zIndex ?? zIndex,
            extra: "extra" in opts ? opts.extra ?? null : extra,
            onClick: "onClick" in opts ? opts.onClick ?? null : onClick,
            onAdded: "onAdded" in opts ? opts.onAdded ?? null : onAdded,
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
        get clickable() { return clickable; },
        set clickable(v: boolean) { clickable = v; emit(); },
        get zIndex() { return zIndex; },
        set zIndex(v: number) { zIndex = v; emit(); },
        get extra() { return extra; },
        set extra(v: Serializable | null) { extra = v; emit(); },
        get onClick() { return onClick; },
        set onClick(v: OnPolylineEventHandler | null) { onClick = v; emit(); },
        get onAdded() { return onAdded; },
        // No emit: onAdded is not part of the fingerprint, so changing it redraws nothing.
        set onAdded(v: OnPolylineAddedHandler | null) { onAdded = v; },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
