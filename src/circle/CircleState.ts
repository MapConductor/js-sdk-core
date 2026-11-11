import { GeoPoint } from "../features";
import { combineHash, hashBool, hashGeoPoint, hashNum, hashObj } from "../features/hash-utils";
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

/** Receives the state whose overlay was just added to the map. See `CircleState.onAdded`. */
export type OnCircleAddedHandler = (state: CircleState) => void;

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
    onAdded: OnCircleAddedHandler | null;
    readonly revision?: number;
    readonly changedFields?: number;
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
    onAdded?: OnCircleAddedHandler | null;
    id?: string | null;
}

function circleId(hashCodes: number[]): number {
    return hashCodes.reduce((result, hc) => (31 * result + hc) | 0, 0);
}

type CircleStateParams = {
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
    onAdded?: OnCircleAddedHandler | null;
    id?: string | null;
};

const circleMutationListeners = new Set<(state: CircleState) => void>();

/** Shared update channel for collectors. Custom CircleState implementations use their own observable. @internal */
export const circleMutations = {
    accepts: (state: CircleState): boolean => state instanceof CircleStateValue,
    subscribe(listener: (state: CircleState) => void): () => void {
        circleMutationListeners.add(listener);
        return () => { circleMutationListeners.delete(listener); };
    },
};

class CircleStateValue implements CircleState {
    declare private readonly values: {
        id: string;
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
        onAdded: OnCircleAddedHandler | null;
        revision: number;
        changedFields: number;
        subject?: ReturnType<typeof createSubject<number>>;
    };

    constructor(params: CircleStateParams) {
        const values = {
            center: params.center,
            radiusMeters: params.radiusMeters,
            geodesic: params.geodesic ?? true,
            clickable: params.clickable ?? true,
            strokeColor: params.strokeColor ?? "#FF0000",
            strokeWidth: params.strokeWidth ?? 1,
            fillColor: params.fillColor ?? "rgba(255,255,255,0.5)",
            extra: params.extra ?? null,
            zIndex: params.zIndex ?? null,
            onClick: params.onClick ?? null,
            onAdded: params.onAdded ?? null,
            revision: 0,
            changedFields: 0,
        };
        const id = params.id ?? circleId([
            hashGeoPoint(values.center),
            hashNum(values.radiusMeters),
            hashBool(values.clickable),
            hashBool(values.geodesic),
            values.extra == null ? 0 : hashObj(values.extra),
            hashObj(values.strokeColor),
            hashNum(values.strokeWidth),
            hashObj(values.fillColor),
            values.zIndex ?? 0,
        ]).toString();
        Object.defineProperty(this, "values", { value: { ...values, id } });
        Object.defineProperties(this, circlePublicProperties);
    }

    private change<K extends keyof CircleStateValue["values"]>(key: K, value: CircleStateValue["values"][K], mask: number): void {
        if (this.values[key] === value) return;
        this.values[key] = value;
        this.values.revision++;
        this.values.changedFields |= mask;
        for (const listener of circleMutationListeners) listener(this);
        this.values.subject?.next(this.values.revision);
    }

    get id() { return this.values.id; }
    get revision() { return this.values.revision; }
    get changedFields() { return this.values.changedFields; }
    get center() { return this.values.center; }
    set center(v: GeoPoint) { this.change("center", v, 1); }
    get radiusMeters() { return this.values.radiusMeters; }
    set radiusMeters(v: number) { this.change("radiusMeters", v, 2); }
    get geodesic() { return this.values.geodesic; }
    set geodesic(v: boolean) { this.change("geodesic", v, 4); }
    get clickable() { return this.values.clickable; }
    set clickable(v: boolean) { this.change("clickable", v, 8); }
    get strokeColor() { return this.values.strokeColor; }
    set strokeColor(v: string) { this.change("strokeColor", v, 16); }
    get strokeWidth() { return this.values.strokeWidth; }
    set strokeWidth(v: number) { this.change("strokeWidth", v, 32); }
    get fillColor() { return this.values.fillColor; }
    set fillColor(v: string) { this.change("fillColor", v, 64); }
    get extra() { return this.values.extra; }
    set extra(v: Serializable | null) { this.change("extra", v, 128); }
    get zIndex() { return this.values.zIndex; }
    set zIndex(v: number | null) { this.change("zIndex", v, 256); }
    get onClick() { return this.values.onClick; }
    set onClick(v: OnCircleEventHandler | null) { this.values.onClick = v; }
    get onAdded() { return this.values.onAdded; }
    set onAdded(v: OnCircleAddedHandler | null) { this.values.onAdded = v; }

    fingerPrint(): CircleFingerPrint {
        const { id, center, radiusMeters, clickable, geodesic, strokeColor, strokeWidth, fillColor, zIndex, extra } = this.values;
        return {
            id: hashObj(id), center: hashGeoPoint(center), radiusMeters: hashNum(radiusMeters),
            clickable: hashBool(clickable), geodesic: hashBool(geodesic), strokeColor: hashObj(strokeColor),
            strokeWidth: hashNum(strokeWidth), fillColor: hashObj(fillColor), zIndex: zIndex ?? 0,
            extra: extra == null ? 0 : hashObj(extra),
        };
    }

    hashCode(): number {
        const { center, clickable, geodesic, radiusMeters, strokeColor, strokeWidth, fillColor, zIndex, extra } = this.values;
        let result = extra == null ? 0 : hashObj(extra);
        result = combineHash(result, hashNum(center.latitude));
        result = combineHash(result, hashNum(center.longitude));
        result = combineHash(result, hashBool(clickable));
        result = combineHash(result, hashBool(geodesic));
        result = combineHash(result, hashNum(radiusMeters));
        result = combineHash(result, hashObj(strokeColor));
        result = combineHash(result, hashNum(strokeWidth));
        result = combineHash(result, hashObj(fillColor));
        return combineHash(result, zIndex ?? 0) | 0;
    }

    copy(opts: CircleStateCopyParams = {}): CircleState {
        return createCircleState({
            id: "id" in opts ? opts.id ?? null : this.id,
            center: opts.center ?? this.center,
            radiusMeters: opts.radiusMeters ?? this.radiusMeters,
            geodesic: opts.geodesic ?? this.geodesic,
            clickable: opts.clickable ?? this.clickable,
            strokeColor: opts.strokeColor ?? this.strokeColor,
            strokeWidth: opts.strokeWidth ?? this.strokeWidth,
            fillColor: opts.fillColor ?? this.fillColor,
            extra: "extra" in opts ? opts.extra ?? null : this.extra,
            zIndex: "zIndex" in opts ? opts.zIndex ?? null : this.zIndex,
            onClick: "onClick" in opts ? opts.onClick ?? null : this.onClick,
            onAdded: "onAdded" in opts ? opts.onAdded ?? null : this.onAdded,
        });
    }

    equals(other: unknown): boolean {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && this.hashCode() === o.hashCode();
    }

    asObservable() {
        return {
            subscribe: (fn: (fp: CircleFingerPrint) => void) => {
                if (!this.values.subject) {
                    this.values.subject = createSubject<number>((a, b) => a === b);
                    this.values.subject.next(this.revision);
                }
                return this.values.subject.subscribe(() => fn(this.fingerPrint()));
            },
        };
    }
}

// Share accessors across circles while keeping the factory's own enumerable fields.
const circlePublicProperties = Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(CircleStateValue.prototype))
        .filter(([name]) => name !== "constructor" && name !== "change")
        .map(([name, descriptor]) => {
            if (typeof descriptor.value !== "function") return [name, { ...descriptor, enumerable: true }];
            const storeMethod = (state: CircleStateValue, value: unknown) =>
                Object.defineProperty(state, name, { value, enumerable: true, writable: true, configurable: true });
            return [name, {
                enumerable: true,
                configurable: true,
                get(this: CircleStateValue) {
                    const method = descriptor.value.bind(this);
                    storeMethod(this, method);
                    return method;
                },
                set(this: CircleStateValue, value: unknown) { storeMethod(this, value); },
            }];
        }),
);

export function createCircleState(params: CircleStateParams): CircleState {
    return new CircleStateValue(params);
}
