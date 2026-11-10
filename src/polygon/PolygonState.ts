import { GeoPoint } from "../features";
import { combineHash, hashBool, hashGeoPoint, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { Serializable } from "../marker";

export interface PolygonFingerPrint {
    id: number;
    strokeColor: number;
    strokeWidth: number;
    fillColor: number;
    geodesic: number;
    clickable: number;
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

/** Receives the state whose overlay was just added to the map. See `PolygonState.onAdded`. */
export type OnPolygonAddedHandler = (state: PolygonState) => void;

export interface PolygonState {
    readonly id: string;
    points: GeoPoint[];
    holes: GeoPoint[][];
    strokeColor: string;
    strokeWidth: number;
    fillColor: string;
    geodesic: boolean;
    /**
     * タップを受け取るか。`false` ならこのポリゴンはタップに対して透過し、
     * 下のオーバーレイ（無ければ地図クリック）へイベントが流れる。
     *
     * 判定はコアの `PolygonManager.find` が行うため、どのプロバイダでも同じ挙動になる。
     * fingerPrint に含めるのは、Google Maps のようにネイティブ側の `clickable` へ
     * 渡すプロバイダがあるため（CircleState と同じ）。
     */
    clickable: boolean;
    zIndex: number;
    extra: Serializable | null;
    onClick: OnPolygonEventHandler | null;
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
    onAdded: OnPolygonAddedHandler | null;
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
    clickable?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolygonEventHandler | null;
    onAdded?: OnPolygonAddedHandler | null;
}

function listHashCode(list: GeoPoint[]): number {
    let result = 0;
    for (const p of list) {
        // android-sdk / ios-sdk と一致: GeoPoint.hashCode（altitude 込み・fold）を使う。
        result = (31 * result + hashGeoPoint(p)) | 0;
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
    a.clickable === b.clickable &&
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
    clickable?: boolean;
    zIndex?: number;
    extra?: Serializable | null;
    onClick?: OnPolygonEventHandler | null;
    onAdded?: OnPolygonAddedHandler | null;
}): PolygonState {
    let points = params.points;
    // 穴のユニオンはここでは行わない。android-sdk と同じく「コンポーネント層でのみ」適用する
    // （PolygonComponent.kt: holes.size > 1 のときだけ state.unionHolesInPlace()）。
    // ctor / copy() / setter でも union すると、unionHolesInPlace 1回の呼び出しで
    // 最大4回 unionHoleRings が走る（unionHoleRings は CW に巻き直すため再入力で再処理になる）。
    let holes = params.holes ?? [];
    let strokeColor = params.strokeColor ?? "#000000";
    let strokeWidth = params.strokeWidth ?? 1;
    let fillColor = params.fillColor ?? "transparent";
    let geodesic = params.geodesic ?? false;
    let clickable = params.clickable ?? true;
    let zIndex = params.zIndex ?? 0;
    let extra = params.extra ?? null;
    let onClick = params.onClick ?? null;
    let onAdded = params.onAdded ?? null;

    const id =
        params.id ??
        polygonId([
            listHashCode(points),
            nestedListHashCode(holes),
            hashObj(strokeColor),
            hashNum(strokeWidth),
            hashObj(fillColor),
            hashBool(geodesic),
            hashBool(clickable),
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
            clickable: hashBool(clickable),
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
        result = combineHash(result, hashBool(clickable));
        result = combineHash(result, zIndex);
        result = combineHash(result, listHashCode(points));
        result = combineHash(result, nestedListHashCode(holes));
        return result | 0;
    };

    const copy = (opts: PolygonStateCopyParams = {}): PolygonState =>
        createPolygonState({
            id: "id" in opts ? opts.id ?? null : id,
            points: opts.points ?? points,
            holes: "holes" in opts ? opts.holes ?? [] : holes,
            strokeColor: opts.strokeColor ?? strokeColor,
            strokeWidth: opts.strokeWidth ?? strokeWidth,
            fillColor: opts.fillColor ?? fillColor,
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
        get clickable() { return clickable; },
        set clickable(v: boolean) { clickable = v; emit(); },
        get zIndex() { return zIndex; },
        set zIndex(v: number) { zIndex = v; emit(); },
        get extra() { return extra; },
        set extra(v: Serializable | null) { extra = v; emit(); },
        get onClick() { return onClick; },
        set onClick(v: OnPolygonEventHandler | null) { onClick = v; emit(); },
        get onAdded() { return onAdded; },
        // No emit: onAdded is not part of the fingerprint, so changing it redraws nothing.
        set onAdded(v: OnPolygonAddedHandler | null) { onAdded = v; },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
