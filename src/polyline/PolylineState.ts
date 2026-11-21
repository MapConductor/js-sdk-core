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

type PolylineStateParams = {
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
};

const polylineMutationListeners = new Set<(state: PolylineState) => void>();

/** Shared update channel for collectors. Custom PolylineState implementations use their own observable. @internal */
export const polylineMutations = {
    accepts: (state: PolylineState): boolean => state instanceof PolylineStateValue,
    subscribe(listener: (state: PolylineState) => void): () => void {
        polylineMutationListeners.add(listener);
        return () => { polylineMutationListeners.delete(listener); };
    },
};

type FingerPrintSubject = ReturnType<typeof createSubject<PolylineFingerPrint>>;

/**
 * Prototype-based PolylineState, like MarkerState and CircleState. The factory it
 * replaces built an object literal of getters, setters and closures per polyline,
 * about 3 KB each before any points, and a subject that collectors on the shared
 * channel never read.
 */
class PolylineStateValue implements PolylineState {
    readonly id: string;

    private _points: GeoPoint[];
    // The points hash last reported. Compared with the hash of what is assigned, so
    // an array edited in place and assigned again is still seen as a change.
    private _pointsHash: number;
    private _strokeColor: string;
    private _strokeWidth: number;
    private _geodesic: boolean;
    private _clickable: boolean;
    private _zIndex: number;
    private _extra: Serializable | null;
    private _onClick: OnPolylineEventHandler | null;
    private _onAdded: OnPolylineAddedHandler | null;

    // Created on the first asObservable() call.
    private _subject: FingerPrintSubject | null = null;

    constructor(params: PolylineStateParams) {
        this._points = params.points;
        this._pointsHash = listHashCode(this._points);
        this._strokeColor = params.strokeColor ?? "#000000";
        this._strokeWidth = params.strokeWidth ?? 1;
        this._geodesic = params.geodesic ?? false;
        this._clickable = params.clickable ?? true;
        this._zIndex = params.zIndex ?? 0;
        this._extra = params.extra ?? null;
        this._onClick = params.onClick ?? null;
        this._onAdded = params.onAdded ?? null;
        this.id =
            params.id ??
            polylineId([
                this._pointsHash,
                hashObj(this._strokeColor),
                hashNum(this._strokeWidth),
                hashBool(this._geodesic),
                hashBool(this._clickable),
                this._extra == null ? 0 : hashObj(this._extra),
            ]).toString();
    }

    // A write that leaves the fingerprint as it was reports nothing, as the
    // subject's distinctUntilChanged did when every write emitted.
    private changed(): void {
        for (const listener of polylineMutationListeners) listener(this);
        this._subject?.next(this.fingerPrint());
    }

    get points() { return this._points; }
    set points(v: GeoPoint[]) {
        const hash = listHashCode(v);
        this._points = v;
        if (hash === this._pointsHash) return;
        this._pointsHash = hash;
        this.changed();
    }
    get strokeColor() { return this._strokeColor; }
    set strokeColor(v: string) {
        if (v === this._strokeColor) return;
        this._strokeColor = v;
        this.changed();
    }
    get strokeWidth() { return this._strokeWidth; }
    set strokeWidth(v: number) {
        if (v === this._strokeWidth) return;
        this._strokeWidth = v;
        this.changed();
    }
    get geodesic() { return this._geodesic; }
    set geodesic(v: boolean) {
        if (v === this._geodesic) return;
        this._geodesic = v;
        this.changed();
    }
    get clickable() { return this._clickable; }
    set clickable(v: boolean) {
        if (v === this._clickable) return;
        this._clickable = v;
        this.changed();
    }
    get zIndex() { return this._zIndex; }
    set zIndex(v: number) {
        if (v === this._zIndex) return;
        this._zIndex = v;
        this.changed();
    }
    get extra() { return this._extra; }
    set extra(v: Serializable | null) {
        const unchanged = (v == null ? 0 : hashObj(v)) === (this._extra == null ? 0 : hashObj(this._extra));
        this._extra = v;
        if (!unchanged) this.changed();
    }
    // onClick and onAdded are not part of the fingerprint: changing them redraws nothing.
    get onClick() { return this._onClick; }
    set onClick(v: OnPolylineEventHandler | null) { this._onClick = v; }
    get onAdded() { return this._onAdded; }
    set onAdded(v: OnPolylineAddedHandler | null) { this._onAdded = v; }

    fingerPrint(): PolylineFingerPrint {
        return {
            id: hashObj(this.id),
            strokeColor: hashObj(this._strokeColor),
            strokeWidth: hashNum(this._strokeWidth),
            geodesic: hashBool(this._geodesic),
            clickable: hashBool(this._clickable),
            zIndex: this._zIndex,
            points: listHashCode(this._points),
            extra: this._extra == null ? 0 : hashObj(this._extra),
        };
    }

    hashCode(): number {
        let result = this._extra == null ? 0 : hashObj(this._extra);
        result = combineHash(result, hashObj(this._strokeColor));
        result = combineHash(result, hashNum(this._strokeWidth));
        result = combineHash(result, hashBool(this._geodesic));
        result = combineHash(result, hashBool(this._clickable));
        result = combineHash(result, this._zIndex);
        result = combineHash(result, listHashCode(this._points));
        return result | 0;
    }

    copy(opts: PolylineStateCopyParams = {}): PolylineState {
        return createPolylineState({
            id: "id" in opts ? opts.id ?? null : this.id,
            points: opts.points ?? this._points,
            strokeColor: opts.strokeColor ?? this._strokeColor,
            strokeWidth: opts.strokeWidth ?? this._strokeWidth,
            geodesic: opts.geodesic ?? this._geodesic,
            clickable: opts.clickable ?? this._clickable,
            zIndex: opts.zIndex ?? this._zIndex,
            extra: "extra" in opts ? opts.extra ?? null : this._extra,
            onClick: "onClick" in opts ? opts.onClick ?? null : this._onClick,
            onAdded: "onAdded" in opts ? opts.onAdded ?? null : this._onAdded,
        });
    }

    equals(other: unknown): boolean {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && this.hashCode() === o.hashCode();
    }

    asObservable() {
        return {
            subscribe: (fn: (fp: PolylineFingerPrint) => void) => {
                if (!this._subject) {
                    this._subject = createSubject<PolylineFingerPrint>(fingerPrintEquals);
                    this._subject.next(this.fingerPrint());
                }
                return this._subject.subscribe(fn);
            },
        };
    }
}

export function createPolylineState(params: PolylineStateParams): PolylineState {
    return new PolylineStateValue(params);
}
