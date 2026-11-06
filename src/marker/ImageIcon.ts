import { combineHash, hashBool, hashNum, hashObj, hashStr } from "../features/hash-utils";
import { Settings } from "../settings";
import { Offset } from "../types";
import { DEFAULT_BASE_PROPERTIES, type MarkerLabelPosition } from "./DefaultIconTypes";
import { toSvgDataUrl, type IconLayout } from "./DefaultIconGeometry";
import { computeIconLabelLayout } from "./IconLabelLayout";
import {
    DEFAULT_LABEL_WRITING_MODE,
    createTileLabel,
    isVerticalWritingMode,
    labelSvgElements,
    type LabelStyle,
    type MarkerTileParts,
} from "./MarkerTileLabel";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";
import { loadRemoteImage, peekRemoteImage, type RemoteImageResult } from "./RemoteImageLoader";

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
    /** ラベルの書字方向。書き方は `DefaultMarkerIconOptions.labelWritingMode` と同じ。 */
    labelWritingMode?: string;
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

/** URL の画像を読み終えるまでの代わり。何も描かない。 */
let transparentPlaceholder: HTMLCanvasElement | null = null;

function placeholderImage(): HTMLCanvasElement {
    if (!transparentPlaceholder) {
        transparentPlaceholder = document.createElement("canvas");
        transparentPlaceholder.width = 1;
        transparentPlaceholder.height = 1;
    }
    return transparentPlaceholder;
}

/** URL の画像の読み込み状態。ハッシュに混ぜる。 */
const UrlImageState = { Pending: 1, Ready: 2, Failed: 3 } as const;
type UrlImageState = (typeof UrlImageState)[keyof typeof UrlImageState];

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
 * 任意の画像ソース（HTMLImageElement / HTMLCanvasElement / ImageBitmap）、または画像の URL を
 * マーカーアイコンとして使用するクラス。
 *
 * ## URL を渡したとき
 *
 * `new ImageIcon("https://…/pin.png")` は SDK が画像を読む（`GroundImageState.imageUrl` と同じ使い方）。
 *
 * - 読み終えるまでは、同じ大きさ・アンカーの透明な画像として描く（ラベルはその間も描く）。
 * - 読み終えたら、このアイコンを持つマーカーは描き直される。呼び出し側で何かする必要は無い。
 * - 同じ URL は 1 回しか読まない。別のアイコンでも、読み終えた画像を使い回す。
 * - CORS で許可された画像だけを描ける（canvas に描いてから地図へ渡すため）。許可されない、
 *   または読めない画像は透明のままになり、コンソールに 1 回警告を出す。
 *
 * Android SDK の ImageIcon に対応する実装。
 */
export class ImageIcon extends AbstractMarkerIcon {
    /** URL で作ったときの、その URL。画像ソースで作ったときは null。 */
    readonly imageUrl: string | null;
    readonly iconSize: number;
    readonly scale: number;
    readonly debug: boolean;
    readonly label: string | null;
    readonly labelTextColor: string | null;
    readonly labelTextSize: number;
    readonly labelTypeFace: string;
    readonly labelStrokeColor: string;
    readonly labelPosition: MarkerLabelPosition;
    readonly labelWritingMode: string;
    private readonly options: { anchor: Offset; infoAnchor: Offset };
    private cachedLayout: IconLayout | null = null;
    private cachedTileParts: MarkerTileParts | null = null;
    private readonly source: ImageSource | null;
    private urlState: UrlImageState | null = null;
    private loadedImage: HTMLImageElement | null = null;
    private settleListeners: (() => void)[] | null = null;

    constructor(image: ImageSource | string, options: ImageIconOptions = {}) {
        super();
        if (typeof image === "string") {
            this.imageUrl = image;
            this.source = null;
            const done = peekRemoteImage(image);
            if (done !== undefined) {
                this.settle(done);
            } else {
                this.urlState = UrlImageState.Pending;
                void loadRemoteImage(image).then(result => this.settle(result));
            }
        } else {
            this.imageUrl = null;
            this.source = image;
        }
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
        this.labelWritingMode = options.labelWritingMode ?? DEFAULT_LABEL_WRITING_MODE;
    }

    /**
     * 描く画像。URL で作ったときは、読み終えるまで（または読めなかったとき）1px の透明な canvas。
     */
    get image(): ImageSource {
        if (this.source) return this.source;
        return this.loadedImage ?? placeholderImage();
    }

    /**
     * URL の画像を読み終える（または失敗する）前なら、そのときに一度だけ `listener` を呼ぶ。
     * 読み込み中でなければ何もせず false を返す。
     *
     * `MarkerState` がアイコンを受け取ったときに使う。読み終えるとハッシュが変わるので、
     * マーカーはそれを変更として描き直す。
     *
     * @internal
     */
    onceImageSettled(listener: () => void): boolean {
        if (this.urlState !== UrlImageState.Pending) return false;
        (this.settleListeners ??= []).push(listener);
        return true;
    }

    private settle(result: RemoteImageResult): void {
        if (this.imageUrl === null || (this.urlState !== null && this.urlState !== UrlImageState.Pending)) return;
        this.loadedImage = result;
        this.urlState = result ? UrlImageState.Ready : UrlImageState.Failed;
        this.cachedTileParts = null;
        const listeners = this.settleListeners;
        this.settleListeners = null;
        listeners?.forEach(listener => listener());
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
            labelWritingMode: this.labelWritingMode,
        });
        return this.cachedLayout;
    }

    /**
     * タイル描画用に、ラベルを除いた画像と、ラベルだけの画像に分けたもの（`MarkerTileLabel`）。
     *
     * 本体はラベルの無い `ImageIcon` と同じ画像なので、ラベルだけ違うアイコンの間で共有される。
     *
     * @internal
     */
    tileParts(): MarkerTileParts {
        if (this.cachedTileParts) return this.cachedTileParts;
        if (!this.label) {
            this.cachedTileParts = { body: this.toBitmapIcon(), label: null };
            return this.cachedTileParts;
        }
        const body = new ImageIcon(this.imageUrl ?? this.image, {
            iconSize: this.iconSize,
            scale: this.scale,
            anchor: this.options.anchor,
            infoAnchor: this.options.infoAnchor,
            debug: this.debug,
        });
        // 読み終えた後でも LRU から落ちていると読み込み中に戻るので、こちらの結果を渡す。
        if (this.imageUrl !== null && this.urlState !== UrlImageState.Pending) body.settle(this.loadedImage);
        const bodyIcon = body.toBitmapIcon();
        const layout = this.computeLayout();
        const anchorX = layout.markerOffsetX + this.options.anchor.x * layout.markerSize;
        const anchorY = layout.markerOffsetY + this.options.anchor.y * layout.markerSize;
        const label = createTileLabel(
            this.labelStyle(layout),
            { width: layout.labelWidth, height: layout.labelHeight, contentWidth: layout.labelWidth },
            layout.labelCenterX - anchorX,
            layout.labelCenterY - anchorY,
        );
        this.cachedTileParts = { body: bodyIcon, label };
        return this.cachedTileParts;
    }

    private labelStyle(layout: IconLayout): LabelStyle {
        return {
            text: this.label ?? "",
            fontSize: this.labelTextSize,
            typeFace: this.labelTypeFace,
            textColor: this.labelTextColor ?? "#000000",
            strokeColor: this.labelStrokeColor,
            outline: layout.outlineStroke,
            vertical: isVerticalWritingMode(this.labelWritingMode),
        };
    }

    private labelProperties(): unknown {
        return {
            label: this.label,
            labelTextColor: this.labelTextColor,
            labelTextSize: this.labelTextSize,
            labelTypeFace: this.labelTypeFace,
            labelStrokeColor: this.labelStrokeColor,
            labelPosition: this.labelPosition,
            labelWritingMode: this.labelWritingMode,
        };
    }

    private getImageIdentity(): number {
        // URL の画像は URL と読み込み状態で見分ける。読み終えたときに一度だけハッシュが変わり、
        // 透明な代わりの絵と読み終えた絵が別々にキャッシュされる。
        if (this.imageUrl !== null) return combineHash(hashStr(this.imageUrl), this.urlState ?? 0);
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

        if (this.imageUrl === null || this.loadedImage) ctx.drawImage(this.image as CanvasImageSource, layout.markerOffsetX, layout.markerOffsetY, scaledSize, scaledSize);
        // Canvas には縦組みが無いので、縦書きのラベルは SVG に任せる（画像はその下に敷く）。
        const verticalLabel = !!this.label && isVerticalWritingMode(this.labelWritingMode);
        if (!verticalLabel) this.drawLabel(ctx, layout);

        if (this.debug) {
            this.drawDebugFrame(ctx);
        }

        const url = verticalLabel
            ? toSvgDataUrl([
                `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.bitmapWidth}" height="${layout.bitmapHeight}" viewBox="0 0 ${layout.bitmapWidth} ${layout.bitmapHeight}">`,
                `<image href="${canvas.toDataURL()}" x="0" y="0" width="${layout.bitmapWidth}" height="${layout.bitmapHeight}"/>`,
                labelSvgElements(this.labelStyle(layout), layout.labelCenterX, layout.labelCenterY),
                "</svg>",
            ].join(""))
            : canvas.toDataURL();
        const result: BitmapIcon = {
            url,
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
