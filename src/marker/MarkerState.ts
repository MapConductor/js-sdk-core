import { GeoPoint } from "../features";
import {
    combineHash,
    generateIdFromHashes,
    hashBool,
    hashNum,
    hashObj,
    toInt,
} from "../features/hash-utils";
import { createSubject } from "../features/subscribe";
import { createFingerPrint, markerIconHashCode, MarkerFingerPrint } from "./MarkerFingerPrint";
import { MarkerAnimation } from "./MarkerAnimation";
import { MarkerIcon } from "./MarkerIcon";
import type { OnMarkerEventHandler } from "./OnMarkerEventHandler";

export type Serializable = string | number | boolean | null | { [key: string]: unknown } | unknown[];

export interface MarkerState {
    position: GeoPoint;
    readonly id: string;
    extra: Serializable | null;
    icon: MarkerIcon | null;
    animation: MarkerAnimation | null;
    clickable: boolean;
    draggable: boolean;
    zIndex: number;
    onClick: OnMarkerEventHandler | null;
    onDragStart: OnMarkerEventHandler | null;
    onDrag: OnMarkerEventHandler | null;
    onDragEnd: OnMarkerEventHandler | null;
    onAnimateStart: OnMarkerEventHandler | null;
    onAnimateEnd: OnMarkerEventHandler | null;
    animate(animation: MarkerAnimation | null): void;
    getAnimation(): MarkerAnimation | null;
    setPosition(position: GeoPoint): void;
    setIcon(icon: MarkerIcon | null): void;
    setClickable(clickable: boolean): void;
    setDraggable(draggable: boolean): void;
    setZIndex(zIndex: number): void;
    copy(opts?: MarkerStateCopyParams): MarkerState;
    equals(other: unknown): boolean;
    hashCode(): number;
    fingerPrint(): MarkerFingerPrint;
    asObservable(): {
        subscribe: (fn: (fingerPrint: MarkerFingerPrint) => void) => () => void;
    };
}

export interface MarkerStateCopyParams {
    id?: string | null;
    position?: GeoPoint;
    extra?: Serializable | null;
    icon?: MarkerIcon | null;
    animation?: MarkerAnimation | null;
    zIndex?: number | null;
    clickable?: boolean | null;
    draggable?: boolean | null;
    onClick?: OnMarkerEventHandler | null;
    onDragStart?: OnMarkerEventHandler | null;
    onDrag?: OnMarkerEventHandler | null;
    onDragEnd?: OnMarkerEventHandler | null;
    onAnimateStart?: OnMarkerEventHandler | null;
    onAnimateEnd?: OnMarkerEventHandler | null;
}

export function createMarkerState(params: {
    position: GeoPoint;
    id?: string | null;
    extra?: Serializable | null;
    icon?: MarkerIcon | null;
    animation?: MarkerAnimation | null;
    zIndex?: number | null;
    clickable?: boolean;
    draggable?: boolean;
    onClick?: OnMarkerEventHandler | null;
    onDragStart?: OnMarkerEventHandler | null;
    onDrag?: OnMarkerEventHandler | null;
    onDragEnd?: OnMarkerEventHandler | null;
    onAnimateStart?: OnMarkerEventHandler | null;
    onAnimateEnd?: OnMarkerEventHandler | null;
}): MarkerState {
    let position = params.position;
    let extra = params.extra ?? null;
    let icon = params.icon ?? null;
    let clickable = params.clickable ?? true;
    let draggable = params.draggable ?? false;
    let zIndex = params.zIndex ?? 0;
    let onClick = params.onClick ?? null;
    let onDragStart = params.onDragStart ?? null;
    let onDrag = params.onDrag ?? null;
    let onDragEnd = params.onDragEnd ?? null;
    let onAnimateStart = params.onAnimateStart ?? null;
    let onAnimateEnd = params.onAnimateEnd ?? null;

    let dragPosition: GeoPoint = position;
    let isDragging = false;
    let _animation: MarkerAnimation | null = params.animation ?? null;
    const internalPosition = () => (isDragging ? dragPosition : position);

    const id =
        params.id ??
        generateIdFromHashes([
            position.hashCode(),
            extra == null ? 0 : hashObj(extra),
            markerIconHashCode(icon),
            hashBool(clickable),
            hashBool(draggable),
            _animation ? hashObj(_animation) : 0,
        ]).toString();

    const subject = createSubject<MarkerFingerPrint>(fingerPrintEquals);

    const emit = () => {
        subject.next(fingerPrint());
    };

    const setPosition = (nextPosition: GeoPoint): void => {
        position = nextPosition;
        if (isDragging) {
            dragPosition = nextPosition;
        }
        emit();
    };

    const setIcon = (nextIcon: MarkerIcon | null): void => {
        icon = nextIcon;
        emit();
    };

    const setClickable = (nextClickable: boolean): void => {
        clickable = nextClickable;
        emit();
    };

    const setDraggable = (nextDraggable: boolean): void => {
        draggable = nextDraggable;
        emit();
    };

    const setZIndex = (nextZIndex: number): void => {
        zIndex = nextZIndex;
        emit();
    };

    const animate = (animation: MarkerAnimation | null): void => {
        _animation = animation;
        emit();
    };

    const getAnimation = (): MarkerAnimation | null => _animation;

    const beginDrag = (): void => {
        isDragging = true;
        dragPosition = position;
    };

    const endDrag = (): void => {
        isDragging = false;
    };

    const setDragPosition = (nextPosition: GeoPoint): void => {
        dragPosition = nextPosition;
    };

    function fingerPrint(): MarkerFingerPrint {
        return createFingerPrint({
            id,
            icon,
            clickable,
            draggable,
            position,
            zIndex,
            getAnimation,
        });
    }

    const copy = (opts: MarkerStateCopyParams = {}): MarkerState => {
        const has = (key: keyof MarkerStateCopyParams): boolean =>
            Object.prototype.hasOwnProperty.call(opts, key);

        return createMarkerState({
            id: has("id") ? opts.id : id,
            position: has("position") ? opts.position! : position,
            extra: has("extra") ? opts.extra ?? null : extra,
            icon: has("icon") ? opts.icon ?? null : icon,
            animation: has("animation") ? opts.animation ?? null : _animation,
            zIndex: has("zIndex") ? opts.zIndex ?? 0 : zIndex,
            clickable: opts.clickable ?? clickable,
            draggable: opts.draggable ?? draggable,
            onClick: has("onClick") ? opts.onClick ?? null : onClick,
            onDragStart: has("onDragStart") ? opts.onDragStart ?? null : onDragStart,
            onDrag: has("onDrag") ? opts.onDrag ?? null : onDrag,
            onDragEnd: has("onDragEnd") ? opts.onDragEnd ?? null : onDragEnd,
            onAnimateStart: has("onAnimateStart") ? opts.onAnimateStart ?? null : onAnimateStart,
            onAnimateEnd: has("onAnimateEnd") ? opts.onAnimateEnd ?? null : onAnimateEnd,
        });
    };

    const hashCode = (): number => {
        let result = extra == null ? 0 : hashObj(extra);
        result = combineHash(result, hashBool(clickable));
        result = combineHash(result, hashBool(draggable));
        result = combineHash(result, hashNum(position.latitude));
        result = combineHash(result, hashNum(position.longitude));
        result = combineHash(result, hashNum(position.altitude ?? 0));
        result = combineHash(result, markerIconHashCode(icon));
        result = combineHash(result, zIndex);
        return toInt(result);
    };

    const equals = (other: unknown): boolean => {
        const candidate = other as { hashCode?: () => number } | null | undefined;
        return typeof candidate?.hashCode === "function" && hashCode() === candidate.hashCode();
    };

    const asObservable = () => ({
        subscribe: subject.subscribe,
    });

    const state = {
        get id() {
            return id;
        },
        get position() {
            return position;
        },
        set position(nextPosition: GeoPoint) {
            setPosition(nextPosition);
        },
        get extra() {
            return extra;
        },
        set extra(nextExtra: Serializable | null) {
            extra = nextExtra;
            emit();
        },
        get icon() {
            return icon;
        },
        set icon(nextIcon: MarkerIcon | null) {
            setIcon(nextIcon);
        },
        get animation() {
            return _animation;
        },
        set animation(nextAnimation: MarkerAnimation | null) {
            animate(nextAnimation);
        },
        get clickable() {
            return clickable;
        },
        set clickable(nextClickable: boolean) {
            setClickable(nextClickable);
        },
        get draggable() {
            return draggable;
        },
        set draggable(nextDraggable: boolean) {
            setDraggable(nextDraggable);
        },
        get zIndex() {
            return zIndex;
        },
        set zIndex(nextZIndex: number) {
            setZIndex(nextZIndex);
        },
        get onClick() {
            return onClick;
        },
        set onClick(listener: OnMarkerEventHandler | null) {
            onClick = listener;
            emit();
        },
        get onDragStart() {
            return onDragStart;
        },
        set onDragStart(listener: OnMarkerEventHandler | null) {
            onDragStart = listener;
            emit();
        },
        get onDrag() {
            return onDrag;
        },
        set onDrag(listener: OnMarkerEventHandler | null) {
            onDrag = listener;
            emit();
        },
        get onDragEnd() {
            return onDragEnd;
        },
        set onDragEnd(listener: OnMarkerEventHandler | null) {
            onDragEnd = listener;
            emit();
        },
        get onAnimateStart() {
            return onAnimateStart;
        },
        set onAnimateStart(listener: OnMarkerEventHandler | null) {
            onAnimateStart = listener;
            emit();
        },
        get onAnimateEnd() {
            return onAnimateEnd;
        },
        set onAnimateEnd(listener: OnMarkerEventHandler | null) {
            onAnimateEnd = listener;
            emit();
        },
        get isDragging() {
            return isDragging;
        },
        get internalPosition() {
            return internalPosition();
        },
        setPosition,
        setIcon,
        setClickable,
        setDraggable,
        setZIndex,
        beginDrag,
        endDrag,
        setDragPosition,
        animate,
        getAnimation,
        copy,
        equals,
        hashCode,
        fingerPrint,
        asObservable,
    };

    emit();
    return state;
}

export const fingerPrintEquals = (left: MarkerFingerPrint, right: MarkerFingerPrint): boolean =>
    left.id === right.id &&
    left.icon === right.icon &&
    left.clickable === right.clickable &&
    left.draggable === right.draggable &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.animation === right.animation &&
    left.zIndex === right.zIndex;
