import { combineHash, hashBool, hashNum, hashObj } from "../features/hash-utils";
import { Settings } from "../settings";
import { Offset } from "../types";
import { DEFAULT_BASE_PROPERTIES, type MarkerLabelPosition } from "./DefaultIconTypes";
import { type IconLayout } from "./DefaultIconGeometry";
import { computeIconLabelLayout } from "./IconLabelLayout";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";

export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface ImageIconOptions {
    iconSize?: number;
    scale?: number;
    /** 画像（iconSize × scale の正方形）に対する割合。ラベルがあってもこの基準は変わらない。 */
    anchor?: Offset;
    /** 画像に対する割合。`anchor` と同じ。 */
    infoAnchor?: Offset;
    debug?: boolean;
    /** 画像に添える文字列。書き方と既定値は `DefaultMarkerIconOptions` と同じ。 */
    label?: string | null;
    labelTextColor?: string | null;
    labelTextSize?: number;
    labelTypeFace?: string;
    labelStrokeColor?: string;
    /**
     * ラベルを画像に対してどこへ置くか。書き方は `DefaultMarkerIconOptions.labelPosition` と同じ。
     *
     * - `left` / `right` は画像の外側に置き、縦は画像の上端・中間・下端に揃える。
     * - `center` 列の `top` / `bottom` は画像の上・下の外側に置く。
     * - `"center center"`（既定）は画像の中央に重ねる。
     */
    labelPosition?: MarkerLabelPosition;
}

// Module-level bitmap icon cache keyed by hashCode.
// android-sdk（BitmapIconCache の LRU）/ ios-sdk 相当のエントリ数上限で LRU 退避する。
const BITMAP_ICON_CACHE_MAX = 512;
const bitmapIconCache = new Map<number, BitmapIcon>();

// WeakMap-based object identity tracking (equivalent to System.identityHashCode)
const objectIdentityMap = new WeakMap<object, number>();
let objectIdentityCounter = 0;

function getObjectIdentity(obj: object): number {
    let id = objectIdentityMap.get(obj);
    if (id === undefined) {
        id = ++objectIdentityCounter;
        objectIdentityMap.set(obj, id);
    }
    return id;
}

function getImageDimensions(image: ImageSource): { width: number; height: number } {
    if (image instanceof HTMLImageElement) {
        return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
    }
    return { width: image.width, height: image.height };
}

/**
 * 画像ソースの同一性ハッシュを計算する。
 *
 * Android の BitmapDrawable.generationId + identityHashCode に相当する実装で、
 * ピクセルデータのハッシュを避け高速に同一性を判定する。
 */
function getImageIdentity(image: ImageSource): number {
    const { width, height } = getImageDimensions(image);
    const identity = getObjectIdentity(image);
    let result = 17;
    result = (31 * result + width) | 0;
    result = (31 * result + height) | 0;
    result = (31 * result + identity) | 0;
    return result;
}

/**
 * 任意の画像ソース（HTMLImageElement / HTMLCanvasElement / ImageBitmap）を
 * マーカーアイコンとして使用するクラス。
 *
 * Android SDK の ImageIcon に対応する実装。
 */
export class ImageIcon extends AbstractMarkerIcon {
    readonly image: ImageSource;
    readonly iconSize: number;
    readonly scale: number;
    readonly debug: boolean;
    readonly label: string | null;
    readonly labelTextColor: string | null;
    readonly labelTextSize: number;
    readonly labelTypeFace: string;
    readonly labelStrokeColor: string;
    readonly labelPosition: MarkerLabelPosition;
    private readonly options: { anchor: Offset; infoAnchor: Offset };
    private cachedLayout: IconLayout | null = null;

    constructor(image: ImageSource, options: ImageIconOptions = {}) {
        super();
        this.image = image;
        this.iconSize = options.iconSize ?? Settings.Default.iconSize;
        this.scale = options.scale ?? 1.0;
        this.options = {
            anchor: options.anchor ?? { x: 0.5, y: 0.5 },
            infoAnchor: options.infoAnchor ?? { x: 0.5, y: 0.5 },
        };
        this.debug = options.debug ?? false;
        this.label = options.label ?? DEFAULT_BASE_PROPERTIES.label;
        this.labelTextColor = options.labelTextColor ?? DEFAULT_BASE_PROPERTIES.labelTextColor;
        this.labelTextSize = options.labelTextSize ?? DEFAULT_BASE_PROPERTIES.labelTextSize;
        this.labelTypeFace = options.labelTypeFace ?? DEFAULT_BASE_PROPERTIES.labelTypeFace;
        this.labelStrokeColor = options.labelStrokeColor ?? DEFAULT_BASE_PROPERTIES.labelStrokeColor;
        this.labelPosition = options.labelPosition ?? DEFAULT_BASE_PROPERTIES.labelPosition;
    }

    /**
     * ビットマップに対する割合。ラベルを横や上に置くとビットマップがその側へ伸びるので、
     * 画像に対する指定値（`requestedAnchor`）をレイアウトから直す。ラベルが無ければ指定値のまま。
     */
    get anchor(): Offset {
        return this.toBitmapOffset(this.options.anchor);
    }

    /** ビットマップに対する割合。`anchor` と同じく、画像に対する指定値から直す。 */
    get infoAnchor(): Offset {
        return this.toBitmapOffset(this.options.infoAnchor);
    }

    /**
     * 指定されたままの anchor（画像に対する割合）。描き直すときはこちらを使う（二重に変換しない）。
     *
     * @internal
     */
    get requestedAnchor(): Offset {
        return this.options.anchor;
    }

    /**
     * 指定されたままの infoAnchor（画像に対する割合）。
     *
     * @internal
     */
    get requestedInfoAnchor(): Offset {
        return this.options.infoAnchor;
    }

    /**
     * ビットマップの幅と高さが、画像（iconSize × scale の正方形）の何倍か。
     * ラベルを横や上に置くと 1 を超える。当たり判定がアイコンの実寸を使うためのもの。
     *
     * @internal
     */
    get extentRatio(): { width: number; height: number } {
        const layout = this.computeLayout();
        return { width: layout.bitmapWidth / layout.markerSize, height: layout.bitmapHeight / layout.markerSize };
    }

    private toBitmapOffset({ x, y }: Offset): Offset {
        if (!this.label) return { x, y };
        const layout = this.computeLayout();
        return {
            x: (layout.markerOffsetX + x * layout.markerSize) / layout.bitmapWidth,
            y: (layout.markerOffsetY + y * layout.markerSize) / layout.bitmapHeight,
        };
    }

    /** 画像の正方形全体を本体として、その外側（または中央）にラベルを置く。 */
    private computeLayout(): IconLayout {
        if (this.cachedLayout) return this.cachedLayout;
        const markerSize = Math.max(1, Math.round(this.iconSize * this.scale));
        this.cachedLayout = computeIconLabelLayout({
            markerSize,
            scale: this.scale,
            body: { left: 0, top: 0, right: markerSize, bottom: markerSize },
            centerY: markerSize / 2,
            label: this.label,
            labelTextSize: this.labelTextSize,
            labelTypeFace: this.labelTypeFace,
            labelPosition: this.labelPosition,
        });
        return this.cachedLayout;
    }

    private labelProperties(): unknown {
        return {
            label: this.label,
            labelTextColor: this.labelTextColor,
            labelTextSize: this.labelTextSize,
            labelTypeFace: this.labelTypeFace,
            labelStrokeColor: this.labelStrokeColor,
            labelPosition: this.labelPosition,
        };
    }

    private getImageIdentity(): number {
        return getImageIdentity(this.image);
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof ImageIcon)) return false;
        return (
            this.getImageIdentity() === other.getImageIdentity() &&
            this.iconSize === other.iconSize &&
            this.scale === other.scale &&
            this.requestedAnchor.x === other.requestedAnchor.x &&
            this.requestedAnchor.y === other.requestedAnchor.y &&
            this.requestedInfoAnchor.x === other.requestedInfoAnchor.x &&
            this.requestedInfoAnchor.y === other.requestedInfoAnchor.y &&
            this.debug === other.debug &&
            hashObj(this.labelProperties()) === hashObj(other.labelProperties())
        );
    }

    hashCode(): number {
        let result = this.getImageIdentity();
        result = combineHash(result, hashNum(this.iconSize));
        result = combineHash(result, hashNum(this.scale));
        result = combineHash(result, hashNum(this.requestedAnchor.x));
        result = combineHash(result, hashNum(this.requestedAnchor.y));
        result = combineHash(result, hashNum(this.requestedInfoAnchor.x));
        result = combineHash(result, hashNum(this.requestedInfoAnchor.y));
        result = combineHash(result, hashBool(this.debug));
        // ラベルが無いときは従来と同じハッシュになるよう、ある場合だけ混ぜる。
        if (this.label) result = combineHash(result, hashObj(this.labelProperties()));
        return result;
    }

    toBitmapIcon(): BitmapIcon {
        const id = this.hashCode();
        const cached = bitmapIconCache.get(id);
        if (cached) {
            // LRU: 最近使用として末尾へ移動する。
            bitmapIconCache.delete(id);
            bitmapIconCache.set(id, cached);
            return cached;
        }

        const layout = this.computeLayout();
        const scaledSize = layout.markerSize;
        const canvas = document.createElement("canvas");
        canvas.width = layout.bitmapWidth;
        canvas.height = layout.bitmapHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("ImageIcon: Failed to get 2D context");

        ctx.drawImage(this.image as CanvasImageSource, layout.markerOffsetX, layout.markerOffsetY, scaledSize, scaledSize);
        this.drawLabel(ctx, layout);

        if (this.debug) {
            this.drawDebugFrame(ctx);
        }

        const result: BitmapIcon = {
            url: canvas.toDataURL(),
            anchor: this.anchor,
            size: { width: layout.bitmapWidth, height: layout.bitmapHeight },
            ...(this.label ? { hitBounds: this.hitBounds(layout) } : {}),
        };
        bitmapIconCache.set(id, result);
        if (bitmapIconCache.size > BITMAP_ICON_CACHE_MAX) {
            const oldest = bitmapIconCache.keys().next().value;
            if (oldest !== undefined) bitmapIconCache.delete(oldest);
        }
        return result;
    }

    /**
     * 既定のピンの SVG と同じく、アウトライン（stroke）を下に敷いてから塗りを重ねる。
     * 中心揃え（text-anchor="middle" / dominant-baseline="central" 相当）。
     */
    private drawLabel(ctx: CanvasRenderingContext2D, layout: IconLayout): void {
        if (!this.label) return;
        ctx.save();
        ctx.font = `${Math.max(1, this.labelTextSize)}px ${this.labelTypeFace}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = layout.outlineStroke;
        ctx.strokeStyle = this.labelStrokeColor;
        ctx.strokeText(this.label, layout.labelCenterX, layout.labelCenterY);
        ctx.fillStyle = this.labelTextColor ?? "#000000";
        ctx.fillText(this.label, layout.labelCenterX, layout.labelCenterY);
        ctx.restore();
    }

    /** 画像とラベル（ビットマップに対する割合）。その間の透明な部分は当たらない。 */
    private hitBounds(layout: IconLayout): NonNullable<BitmapIcon["hitBounds"]> {
        const left = Math.min(layout.markerOffsetX, layout.labelCenterX - layout.labelWidth / 2);
        const right = Math.max(layout.markerOffsetX + layout.markerSize, layout.labelCenterX + layout.labelWidth / 2);
        const top = Math.min(layout.markerOffsetY, layout.labelCenterY - layout.labelHeight / 2);
        const bottom = Math.max(layout.markerOffsetY + layout.markerSize, layout.labelCenterY + layout.labelHeight / 2);
        const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
        return {
            left: clamp(left / layout.bitmapWidth),
            top: clamp(top / layout.bitmapHeight),
            right: clamp(right / layout.bitmapWidth),
            bottom: clamp(bottom / layout.bitmapHeight),
        };
    }
}
