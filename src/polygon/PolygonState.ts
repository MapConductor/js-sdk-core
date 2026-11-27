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

type PolygonStateParams = {
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
};

const polygonMutationListeners = new Set<(state: PolygonState) => void>();

/** Shared update channel for collectors. Custom PolygonState implementations use their own observable. @internal */
export const polygonMutations = {
    accepts: (state: PolygonState): boolean => state instanceof PolygonStateValue,
    subscribe(listener: (state: PolygonState) => void): () => void {
        polygonMutationListeners.add(listener);
        return () => { polygonMutationListeners.delete(listener); };
    },
};

type FingerPrintSubject = ReturnType<typeof createSubject<PolygonFingerPrint>>;

/**
 * Prototype-based PolygonState, like MarkerState and CircleState. The factory it
 * replaces built an object literal of getters, setters and closures per polygon,
 * about 3.5 KB each before any points, and a subject that collectors on the shared
 * channel never read.
 */
class PolygonStateValue implements PolygonState {
    readonly id: string;

    private _points: GeoPoint[];
    // The points hash last reported. Compared with the hash of what is assigned, so
    // an array edited in place and assigned again is still seen as a change.
    private _pointsHash: number;
    // 穴のユニオンはここでは行わない。android-sdk と同じく「コンポーネント層でのみ」適用する
    // （PolygonComponent.kt: holes.size > 1 のときだけ state.unionHolesInPlace()）。
    // ctor / copy() / setter でも union すると、unionHolesInPlace 1回の呼び出しで
    // 最大4回 unionHoleRings が走る（unionHoleRings は CW に巻き直すため再入力で再処理になる）。
    private _holes: GeoPoint[][];
    private _holesHash: number;
    private _strokeColor: string;
    private _strokeWidth: number;
    private _fillColor: string;
    private _geodesic: boolean;
    private _clickable: boolean;
    private _zIndex: number;
    private _extra: Serializable | null;
    private _onClick: OnPolygonEventHandler | null;
    private _onAdded: OnPolygonAddedHandler | null;

    // Created on the first asObservable() call.
    private _subject: FingerPrintSubject | null = null;

    constructor(params: PolygonStateParams) {
        this._points = params.points;
        this._pointsHash = listHashCode(this._points);
        this._holes = params.holes ?? [];
        this._holesHash = nestedListHashCode(this._holes);
        this._strokeColor = params.strokeColor ?? "#000000";
        this._strokeWidth = params.strokeWidth ?? 1;
        this._fillColor = params.fillColor ?? "transparent";
        this._geodesic = params.geodesic ?? false;
        this._clickable = params.clickable ?? true;
        this._zIndex = params.zIndex ?? 0;
        this._extra = params.extra ?? null;
        this._onClick = params.onClick ?? null;
        this._onAdded = params.onAdded ?? null;
        this.id =
            params.id ??
            polygonId([
                this._pointsHash,
                this._holesHash,
                hashObj(this._strokeColor),
                hashNum(this._strokeWidth),
                hashObj(this._fillColor),
                hashBool(this._geodesic),
                hashBool(this._clickable),
                this._extra == null ? 0 : hashObj(this._extra),
            ]).toString();
    }

    // A write that leaves the fingerprint as it was reports nothing, as the
    // subject's distinctUntilChanged did when every write emitted.
    private changed(): void {
        for (const listener of polygonMutationListeners) listener(this);
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
    get holes() { return this._holes; }
    set holes(v: GeoPoint[][]) {
        const hash = nestedListHashCode(v);
        this._holes = v;
        if (hash === this._holesHash) return;
        this._holesHash = hash;
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
    get fillColor() { return this._fillColor; }
    set fillColor(v: string) {
        if (v === this._fillColor) return;
        this._fillColor = v;
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
    set onClick(v: OnPolygonEventHandler | null) { this._onClick = v; }
    get onAdded() { return this._onAdded; }
    set onAdded(v: OnPolygonAddedHandler | null) { this._onAdded = v; }

    fingerPrint(): PolygonFingerPrint {
        return {
            id: hashObj(this.id),
            strokeColor: hashObj(this._strokeColor),
            strokeWidth: hashNum(this._strokeWidth),
            fillColor: hashObj(this._fillColor),
            geodesic: hashBool(this._geodesic),
            clickable: hashBool(this._clickable),
            zIndex: this._zIndex,
            points: listHashCode(this._points),
            holes: nestedListHashCode(this._holes),
            extra: this._extra == null ? 0 : hashObj(this._extra),
        };
    }

    hashCode(): number {
        let result = this._extra == null ? 0 : hashObj(this._extra);
        result = combineHash(result, hashObj(this._strokeColor));
        result = combineHash(result, hashNum(this._strokeWidth));
        result = combineHash(result, hashObj(this._fillColor));
        result = combineHash(result, hashBool(this._geodesic));
        result = combineHash(result, hashBool(this._clickable));
        result = combineHash(result, this._zIndex);
        result = combineHash(result, listHashCode(this._points));
        result = combineHash(result, nestedListHashCode(this._holes));
        return result | 0;
    }

    /**
     * 中身を引き継いだ新しい PolygonState を返す。id は引き継がず、新しい中身から計算し直す
     * （`id` を渡したときだけそれを使う）。描画側は id で区別するので、引き継ぐと copy で
     * 増やした図形が元の図形を上書きして 1 つにしか見えなかった。
     * 同じ図形として更新したいときは `copy({ id: state.id, ... })` と明示する。
     */
    copy(opts: PolygonStateCopyParams = {}): PolygonState {
        return createPolygonState({
            id: opts.id ?? null,
            points: opts.points ?? this._points,
            holes: "holes" in opts ? opts.holes ?? [] : this._holes,
            strokeColor: opts.strokeColor ?? this._strokeColor,
            strokeWidth: opts.strokeWidth ?? this._strokeWidth,
            fillColor: opts.fillColor ?? this._fillColor,
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
            subscribe: (fn: (fp: PolygonFingerPrint) => void) => {
                if (!this._subject) {
                    this._subject = createSubject<PolygonFingerPrint>(fingerPrintEquals);
                    this._subject.next(this.fingerPrint());
                }
                return this._subject.subscribe(fn);
            },
        };
    }
}

export function createPolygonState(params: PolygonStateParams): PolygonState {
    return new PolygonStateValue(params);
}
