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

export interface CreateMarkerStateParams {
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
}

export function createMarkerState(params: CreateMarkerStateParams): MarkerState {
    return new MarkerStateImpl(params);
}

type FingerPrintSubject = ReturnType<typeof createSubject<MarkerFingerPrint>>;

/**
 * Prototype-based MarkerState. Accessors and methods live on the prototype and are shared across
 * instances, instead of the ~30 per-instance closures the previous factory-function
 * implementation allocated for every marker. This matters at scale: apps commonly render marker
 * sets in the thousands (e.g. all post offices in a region), where closure + Subject allocation
 * per marker was a measurable chunk of the time spent building the marker list.
 */
class MarkerStateImpl implements MarkerState {
    readonly id: string;

    private _position: GeoPoint;
    private _extra: Serializable | null;
    private _icon: MarkerIcon | null;
    private _animation: MarkerAnimation | null;
    private _clickable: boolean;
    private _draggable: boolean;
    private _zIndex: number;
    private _onClick: OnMarkerEventHandler | null;
    private _onDragStart: OnMarkerEventHandler | null;
    private _onDrag: OnMarkerEventHandler | null;
    private _onDragEnd: OnMarkerEventHandler | null;
    private _onAnimateStart: OnMarkerEventHandler | null;
    private _onAnimateEnd: OnMarkerEventHandler | null;

    private _dragPosition: GeoPoint;
    private _isDragging = false;

    // Created lazily on the first asObservable() call rather than at construction. Most markers
    // in a large set are never individually subscribed to (OverlayCollector only subscribes when
    // an update handler has been registered), so this avoids a Set + closure allocation per
    // marker that would otherwise go unused.
    private _subject: FingerPrintSubject | null = null;

    constructor(params: CreateMarkerStateParams) {
        this._position = params.position;
        this._extra = params.extra ?? null;
        this._icon = params.icon ?? null;
        this._clickable = params.clickable ?? true;
        this._draggable = params.draggable ?? false;
        this._zIndex = params.zIndex ?? 0;
        this._onClick = params.onClick ?? null;
        this._onDragStart = params.onDragStart ?? null;
        this._onDrag = params.onDrag ?? null;
        this._onDragEnd = params.onDragEnd ?? null;
        this._onAnimateStart = params.onAnimateStart ?? null;
        this._onAnimateEnd = params.onAnimateEnd ?? null;
        this._animation = params.animation ?? null;
        this._dragPosition = this._position;

        this.id =
            params.id ??
            generateIdFromHashes([
                this._position.hashCode(),
                this._extra == null ? 0 : hashObj(this._extra),
                markerIconHashCode(this._icon),
                hashBool(this._clickable),
                hashBool(this._draggable),
                this._animation ? hashObj(this._animation) : 0,
            ]).toString();
    }

    get position(): GeoPoint {
        return this._position;
    }
    set position(nextPosition: GeoPoint) {
        this.setPosition(nextPosition);
    }

    get extra(): Serializable | null {
        return this._extra;
    }
    set extra(nextExtra: Serializable | null) {
        this._extra = nextExtra;
        this.emit();
    }

    get icon(): MarkerIcon | null {
        return this._icon;
    }
    set icon(nextIcon: MarkerIcon | null) {
        this.setIcon(nextIcon);
    }

    get animation(): MarkerAnimation | null {
        return this._animation;
    }
    set animation(nextAnimation: MarkerAnimation | null) {
        this.animate(nextAnimation);
    }

    get clickable(): boolean {
        return this._clickable;
    }
    set clickable(nextClickable: boolean) {
        this.setClickable(nextClickable);
    }

    get draggable(): boolean {
        return this._draggable;
    }
    set draggable(nextDraggable: boolean) {
        this.setDraggable(nextDraggable);
    }

    get zIndex(): number {
        return this._zIndex;
    }
    set zIndex(nextZIndex: number) {
        this.setZIndex(nextZIndex);
    }

    get onClick(): OnMarkerEventHandler | null {
        return this._onClick;
    }
    set onClick(listener: OnMarkerEventHandler | null) {
        this._onClick = listener;
        this.emit();
    }

    get onDragStart(): OnMarkerEventHandler | null {
        return this._onDragStart;
    }
    set onDragStart(listener: OnMarkerEventHandler | null) {
        this._onDragStart = listener;
        this.emit();
    }

    get onDrag(): OnMarkerEventHandler | null {
        return this._onDrag;
    }
    set onDrag(listener: OnMarkerEventHandler | null) {
        this._onDrag = listener;
        this.emit();
    }

    get onDragEnd(): OnMarkerEventHandler | null {
        return this._onDragEnd;
    }
    set onDragEnd(listener: OnMarkerEventHandler | null) {
        this._onDragEnd = listener;
        this.emit();
    }

    get onAnimateStart(): OnMarkerEventHandler | null {
        return this._onAnimateStart;
    }
    set onAnimateStart(listener: OnMarkerEventHandler | null) {
        this._onAnimateStart = listener;
        this.emit();
    }

    get onAnimateEnd(): OnMarkerEventHandler | null {
        return this._onAnimateEnd;
    }
    set onAnimateEnd(listener: OnMarkerEventHandler | null) {
        this._onAnimateEnd = listener;
        this.emit();
    }

    get isDragging(): boolean {
        return this._isDragging;
    }

    get internalPosition(): GeoPoint {
        return this._isDragging ? this._dragPosition : this._position;
    }

    setPosition(nextPosition: GeoPoint): void {
        this._position = nextPosition;
        if (this._isDragging) {
            this._dragPosition = nextPosition;
        }
        this.emit();
    }

    setIcon(nextIcon: MarkerIcon | null): void {
        this._icon = nextIcon;
        this.emit();
    }

    setClickable(nextClickable: boolean): void {
        this._clickable = nextClickable;
        this.emit();
    }

    setDraggable(nextDraggable: boolean): void {
        this._draggable = nextDraggable;
        this.emit();
    }

    setZIndex(nextZIndex: number): void {
        this._zIndex = nextZIndex;
        this.emit();
    }

    animate(animation: MarkerAnimation | null): void {
        this._animation = animation;
        this.emit();
    }

    getAnimation(): MarkerAnimation | null {
        return this._animation;
    }

    beginDrag(): void {
        this._isDragging = true;
        this._dragPosition = this._position;
    }

    endDrag(): void {
        this._isDragging = false;
    }

    setDragPosition(nextPosition: GeoPoint): void {
        this._dragPosition = nextPosition;
    }

    fingerPrint(): MarkerFingerPrint {
        return createFingerPrint({
            id: this.id,
            icon: this._icon,
            clickable: this._clickable,
            draggable: this._draggable,
            position: this._position,
            zIndex: this._zIndex,
            getAnimation: () => this._animation,
        });
    }

    copy(opts: MarkerStateCopyParams = {}): MarkerState {
        const has = (key: keyof MarkerStateCopyParams): boolean =>
            Object.prototype.hasOwnProperty.call(opts, key);

        return createMarkerState({
            id: has("id") ? opts.id : this.id,
            position: has("position") ? opts.position! : this._position,
            extra: has("extra") ? opts.extra ?? null : this._extra,
            icon: has("icon") ? opts.icon ?? null : this._icon,
            animation: has("animation") ? opts.animation ?? null : this._animation,
            zIndex: has("zIndex") ? opts.zIndex ?? 0 : this._zIndex,
            clickable: opts.clickable ?? this._clickable,
            draggable: opts.draggable ?? this._draggable,
            onClick: has("onClick") ? opts.onClick ?? null : this._onClick,
            onDragStart: has("onDragStart") ? opts.onDragStart ?? null : this._onDragStart,
            onDrag: has("onDrag") ? opts.onDrag ?? null : this._onDrag,
            onDragEnd: has("onDragEnd") ? opts.onDragEnd ?? null : this._onDragEnd,
            onAnimateStart: has("onAnimateStart") ? opts.onAnimateStart ?? null : this._onAnimateStart,
            onAnimateEnd: has("onAnimateEnd") ? opts.onAnimateEnd ?? null : this._onAnimateEnd,
        });
    }

    hashCode(): number {
        let result = this._extra == null ? 0 : hashObj(this._extra);
        result = combineHash(result, hashBool(this._clickable));
        result = combineHash(result, hashBool(this._draggable));
        result = combineHash(result, hashNum(this._position.latitude));
        result = combineHash(result, hashNum(this._position.longitude));
        result = combineHash(result, hashNum(this._position.altitude ?? 0));
        result = combineHash(result, markerIconHashCode(this._icon));
        result = combineHash(result, this._zIndex);
        return toInt(result);
    }

    equals(other: unknown): boolean {
        const candidate = other as { hashCode?: () => number } | null | undefined;
        return typeof candidate?.hashCode === "function" && this.hashCode() === candidate.hashCode();
    }

    asObservable(): {
        subscribe: (fn: (fingerPrint: MarkerFingerPrint) => void) => () => void;
    } {
        return { subscribe: (fn) => this.ensureSubject().subscribe(fn) };
    }

    private ensureSubject(): FingerPrintSubject {
        if (!this._subject) {
            this._subject = createSubject<MarkerFingerPrint>(fingerPrintEquals);
            this._subject.next(this.fingerPrint());
        }
        return this._subject;
    }

    private emit(): void {
        this._subject?.next(this.fingerPrint());
    }
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
