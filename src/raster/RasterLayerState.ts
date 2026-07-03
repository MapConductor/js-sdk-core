import { combineHash, hashBool, hashNum, hashObj } from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { RasterLayerSource } from "./RasterLayerSource";

const DEFAULT_USER_AGENT = "MapConductor/RasterLayerAgent(https://mapconductor.com)";

export interface RasterLayerFingerPrint {
    id: number;
    source: number;
    opacity: number;
    visible: number;
    zIndex: number;
    userAgent: number;
    debug: number;
    extra: number;
}

export interface RasterLayerEvent {
    state: RasterLayerState;
}

export type OnRasterLayerEventHandler = (event: RasterLayerEvent) => void;

export interface RasterLayerState {
    readonly id: string;
    source: RasterLayerSource;
    opacity: number;
    visible: boolean;
    zIndex: number;
    userAgent: string;
    debug: boolean;
    extraHeaders: Record<string, string> | null;
    fingerPrint(): RasterLayerFingerPrint;
    copy(opts?: RasterLayerStateCopyParams): RasterLayerState;
    equals(other: unknown): boolean;
    hashCode(): number;
    asObservable(): { subscribe: (fn: (fp: RasterLayerFingerPrint) => void) => () => void };
}

export interface RasterLayerStateCopyParams {
    source?: RasterLayerSource;
    opacity?: number;
    visible?: boolean;
    zIndex?: number;
    userAgent?: string;
    debug?: boolean;
    extraHeaders?: Record<string, string> | null;
    id?: string | null;
}

const fingerPrintEquals = (a: RasterLayerFingerPrint, b: RasterLayerFingerPrint): boolean =>
    a.id === b.id &&
    a.source === b.source &&
    a.opacity === b.opacity &&
    a.visible === b.visible &&
    a.zIndex === b.zIndex &&
    a.userAgent === b.userAgent &&
    a.debug === b.debug &&
    a.extra === b.extra;

export function createRasterLayerState(params: {
    source: RasterLayerSource;
    opacity?: number;
    visible?: boolean;
    zIndex?: number;
    userAgent?: string;
    debug?: boolean;
    extraHeaders?: Record<string, string> | null;
    id?: string | null;
}): RasterLayerState {
    let source = params.source;
    let opacity = params.opacity ?? 1.0;
    let visible = params.visible ?? true;
    let zIndex = params.zIndex ?? 0;
    let userAgent = params.userAgent ?? DEFAULT_USER_AGENT;
    let debug = params.debug ?? false;
    let extraHeaders = params.extraHeaders ?? null;

    const generateId = (): string => {
        let result = hashObj(source);
        result = combineHash(result, hashNum(opacity));
        result = combineHash(result, hashBool(visible));
        result = combineHash(result, hashBool(debug));
        result = combineHash(result, extraHeaders == null ? 0 : hashObj(extraHeaders));
        return (result | 0).toString();
    };

    const id = params.id ?? generateId();
    const subject = createSubject<RasterLayerFingerPrint>(fingerPrintEquals);
    const emit = () => subject.next(fingerPrint());

    function fingerPrint(): RasterLayerFingerPrint {
        return {
            id: hashObj(id),
            source: hashObj(source),
            opacity: hashNum(opacity),
            visible: hashBool(visible),
            zIndex,
            userAgent: hashObj(userAgent),
            debug: hashBool(debug),
            extra: extraHeaders == null ? 0 : hashObj(extraHeaders),
        };
    }

    const hashCode = (): number => {
        let result = hashObj(source);
        result = combineHash(result, hashNum(opacity));
        result = combineHash(result, hashBool(visible));
        result = combineHash(result, zIndex);
        result = combineHash(result, hashBool(debug));
        result = combineHash(result, extraHeaders == null ? 0 : hashObj(extraHeaders));
        result = combineHash(result, hashObj(userAgent));
        return result | 0;
    };

    const copy = (opts: RasterLayerStateCopyParams = {}): RasterLayerState =>
        createRasterLayerState({
            id: "id" in opts ? opts.id ?? null : id,
            source: opts.source ?? source,
            opacity: opts.opacity ?? opacity,
            visible: opts.visible ?? visible,
            zIndex: opts.zIndex ?? zIndex,
            userAgent: opts.userAgent ?? userAgent,
            debug: opts.debug ?? debug,
            extraHeaders: "extraHeaders" in opts ? opts.extraHeaders ?? null : extraHeaders,
        });

    const equals = (other: unknown): boolean => {
        const o = other as { hashCode?: () => number } | null | undefined;
        return typeof o?.hashCode === "function" && hashCode() === o.hashCode();
    };

    const state: RasterLayerState = {
        get id() { return id; },
        get source() { return source; },
        set source(v: RasterLayerSource) { source = v; emit(); },
        get opacity() { return opacity; },
        set opacity(v: number) { opacity = v; emit(); },
        get visible() { return visible; },
        set visible(v: boolean) { visible = v; emit(); },
        get zIndex() { return zIndex; },
        set zIndex(v: number) { zIndex = v; emit(); },
        get userAgent() { return userAgent; },
        set userAgent(v: string) { userAgent = v; emit(); },
        get debug() { return debug; },
        set debug(v: boolean) { debug = v; emit(); },
        get extraHeaders() { return extraHeaders; },
        set extraHeaders(v: Record<string, string> | null) { extraHeaders = v; emit(); },
        fingerPrint,
        copy,
        equals,
        hashCode,
        asObservable: () => ({ subscribe: subject.subscribe }),
    };

    emit();
    return state;
}
