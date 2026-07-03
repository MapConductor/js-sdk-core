import { GeoPoint, GeoRectBounds } from "../features";
import { combineHash, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { Serializable } from "../marker/MarkerState";

export interface GroundImageFingerPrint {
    id: number;
    bounds: number;
    imageUrl: number;
    opacity: number;
    tileSize: number;
    extra: number;
}

export interface GroundImageEvent {
    state: GroundImageState;
    clicked: GeoPoint | null;
}

export type OnGroundImageEventHandler = (event: GroundImageEvent) => void;

export interface GroundImageState {
    readonly id: string;
    bounds: GeoRectBounds;
    imageUrl: string;
    opacity: number;
    tileSize: number;
    extra: Serializable | null;
    onClick: OnGroundImageEventHandler | null;
    fingerPrint(): GroundImageFingerPrint;
    copy(opts?: GroundImageStateCopyParams): GroundImageState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): { subscribe: (fn: (fp: GroundImageFingerPrint) => void) => () => void };
}

export interface GroundImageStateCopyParams {
    bounds?: GeoRectBounds;
    imageUrl?: string;
    opacity?: number;
    tileSize?: number;
    extra?: Serializable | null;
    onClick?: OnGroundImageEventHandler | null;
    id?: string | null;
}

const DEFAULT_TILE_SIZE = 256;

const fingerPrintEquals = (a: GroundImageFingerPrint, b: GroundImageFingerPrint): boolean =>
    a.id === b.id &&
    a.bounds === b.bounds &&
    a.imageUrl === b.imageUrl &&
    a.opacity === b.opacity &&
    a.tileSize === b.tileSize &&
    a.extra === b.extra;

export function createGroundImageState(params: {
    bounds: GeoRectBounds;
    imageUrl: string;
    opacity?: number;
    tileSize?: number;
    id?: string | null;
    extra?: Serializable | null;
    onClick?: OnGroundImageEventHandler | null;
}): GroundImageState {
    let bounds = params.bounds;
    let imageUrl = params.imageUrl;
    let opacity = params.opacity ?? 1.0;
    let tileSize = params.tileSize ?? DEFAULT_TILE_SIZE;
    let extra = params.extra ?? null;
    let onClick = params.onClick ?? null;

    const generateId = (): string => {
        let result = hashObj(bounds);
        result = combineHash(result, hashObj(imageUrl));
        result = combineHash(result, hashNum(opacity));
        result = combineHash(result, tileSize);
        result = combineHash(result, extra == null ? 0 : hashObj(extra));
        return (result | 0).toString();
    };

    const id = params.id ?? generateId();
    const subject = createSubject<GroundImageFingerPrint>(fingerPrintEquals);
    const emit = () => subject.next(fingerPrint());

    function fingerPrint(): GroundImageFingerPrint {
        return {
            id: hashObj(id),
            bounds: hashObj(bounds),
            imageUrl: hashObj(imageUrl),
            opacity: hashNum(opacity),
            tileSize,
            extra: extra == null ? 0 : hashObj(extra),
        };
    }

    const hashCode = (): number => {
        return (fingerPrint().id ^ fingerPrint().bounds ^ fingerPrint().imageUrl) | 0;
    };

    const copy = (opts: GroundImageStateCopyParams = {}): GroundImageState =>
        createGroundImageState({
            id: "id" in opts ? opts.id ?? null : id,
            bounds: opts.bounds ?? bounds,
            imageUrl: opts.imageUrl ?? imageUrl,
            opacity: opts.opacity ?? opacity,
            tileSize: opts.tileSize ?? tileSize,
            extra: "extra" in opts ? opts.extra ?? null : extra,
            onClick: "onClick" in opts ? opts.onClick ?? null : onClick,
        });

    const equals = (other: unknown): boolean => {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && hashCode() === o.hashCode();
    };

    const state: GroundImageState = {
        get id() { return id; },
        get bounds() { return bounds; },
        set bounds(v: GeoRectBounds) { bounds = v; emit(); },
        get imageUrl() { return imageUrl; },
        set imageUrl(v: string) { imageUrl = v; emit(); },
        get opacity() { return opacity; },
        set opacity(v: number) { opacity = v; emit(); },
        get tileSize() { return tileSize; },
        set tileSize(v: number) { tileSize = v; emit(); },
        get extra() { return extra; },
        set extra(v: Serializable | null) { extra = v; emit(); },
        get onClick() { return onClick; },
        set onClick(v: OnGroundImageEventHandler | null) { onClick = v; emit(); },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
