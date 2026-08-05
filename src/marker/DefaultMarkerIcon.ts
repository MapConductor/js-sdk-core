import { hashObj, hashStr } from "../features/hash-utils";
import { Settings } from "../settings";
import { Offset } from "../types";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";

/**
 * Android ColorDefaultIcon / iOS DefaultMarkerIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */
export interface DefaultMarkerIconOptions {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    scale?: number;
    label?: string | null;
    labelTextColor?: string | null;
    labelTextSize?: number;
    labelTypeFace?: string;
    labelStrokeColor?: string;
    infoAnchor?: Offset;
    iconSize?: number;
    debug?: boolean;
}

/** ImageDefaultIcon のコンストラクタ引数。backgroundImage は必須。 */
export interface ImageDefaultIconOptions extends DefaultMarkerIconOptions {
    backgroundImage: string | HTMLImageElement;
}

interface BaseIconProperties {
    strokeColor: string;
    strokeWidth: number;
    scale: number;
    label: string | null;
    labelTextColor: string | null;
    labelTextSize: number;
    labelTypeFace: string;
    labelStrokeColor: string;
    infoAnchor: Offset;
    iconSize: number;
    debug: boolean;
}

const DEFAULT_FILL_COLOR = "#FF0000";
const DEFAULT_LABEL_TYPE_FACE = "sans-serif";

const DEFAULT_BASE_PROPERTIES: BaseIconProperties = {
    strokeColor: "#FFFFFF",
    strokeWidth: Settings.Default.iconStroke,
    scale: 1,
    label: null,
    labelTextColor: "#000000",
    labelTextSize: 18,
    labelTypeFace: DEFAULT_LABEL_TYPE_FACE,
    labelStrokeColor: "#FFFFFF",
    infoAnchor: { x: 0.5, y: 0 },
    iconSize: Settings.Default.iconSize,
    debug: false,
};

// Android DefaultMarkerIcon.kt createMarkerPath() の移植。
// originalSize はパスの設計座標系における基準サイズ（ストローク余白を含む）。
const MARKER_ORIGINAL_SIZE = { width: 23.5, height: 25.6 } as const;

/**
 * Android AbstractDefaultIcon.createMarkerPath() の移植。
 *
 * @param canvasSize   描画座標系のサイズ（SVG viewBox の場合は 48）
 * @param iconScale    アイコン全体のスケール（this.scale に対応）
 * @param strokeWidth  ストローク幅（スケール適用前の値 this.strokeWidth に対応）
 * @param horizontalOffset  水平オフセット（複数マーカー並置時に使用）
 */
function createMarkerPathData(
    canvasSize: number,
    iconScale: number,
    strokeWidth: number,
    horizontalOffset: number = 0,
): string {
    // Android: scaledStrokeWidth = dpToPx(strokeWidth * iconScale)
    const scaledStrokeWidth = strokeWidth * iconScale;
    const epsilon = 0.75;
    const padding = Math.max(0, scaledStrokeWidth / 2 - epsilon);
    const availableWidth = canvasSize - padding * 2;
    const availableHeight = canvasSize - padding;

    // Android: markerScale = min(availableWidth / originalSize.width, availableHeight / originalSize.height)
    const s = Math.min(
        availableWidth / MARKER_ORIGINAL_SIZE.width,
        availableHeight / MARKER_ORIGINAL_SIZE.height,
    );

    const scaledWidth = MARKER_ORIGINAL_SIZE.width * s;
    const scaledHeight = MARKER_ORIGINAL_SIZE.height * s;

    // Android: offsetX = (canvasSize - scaledWidth) / 2 + horizontalOffset
    //          offsetY = (canvasSize - scaledHeight + strokeWidth.value * markerScale) / 2
    //          strokeWidth.value はスケール前の dp 値（TypeScript では strokeWidth に対応）
    const ox = (canvasSize - scaledWidth) / 2 + horizontalOffset;
    const oy = (canvasSize - scaledHeight + strokeWidth * s) / 2;

    let cx = 12 * s + ox;
    let cy = oy;

    // SVG パス文字列用の数値フォーマット（4桁精度、末尾ゼロ除去）
    const fmt = (n: number): string => String(parseFloat(n.toFixed(4)));

    // 相対ベジェ → 絶対座標変換ヘルパー
    const cubic = (
        dx1: number, dy1: number,
        dx2: number, dy2: number,
        dx: number,  dy: number,
    ): string =>
        `C ${fmt(cx + dx1*s)} ${fmt(cy + dy1*s)}` +
        ` ${fmt(cx + dx2*s)} ${fmt(cy + dy2*s)}` +
        ` ${fmt(cx + dx*s)} ${fmt(cy + dy*s)}`;

    const line = (dx: number, dy: number): string =>
        `L ${fmt(cx + dx*s)} ${fmt(cy + dy*s)}`;

    const parts: string[] = [`M ${fmt(cx)} ${fmt(cy)}`];

    // rCubicTo(-4.4183, 2.3685e-15, -8, 3.5817, -8, 8)  ← 2.3685e-15 は実質 0
    parts.push(cubic(-4.4183, 0, -8, 3.5817, -8, 8));
    cx -= 8*s; cy += 8*s;

    // rCubicTo(0, 1.421, 0.3816, 2.75, 1.0312, 3.906)
    parts.push(cubic(0, 1.421, 0.3816, 2.75, 1.0312, 3.906));
    cx += 1.0312*s; cy += 3.906*s;

    // rCubicTo(0.1079, 0.192, 0.221, 0.381, 0.3438, 0.563)
    parts.push(cubic(0.1079, 0.192, 0.221, 0.381, 0.3438, 0.563));
    cx += 0.3438*s; cy += 0.563*s;

    // rLineTo(6.625, 11.531)  ← 左下から底点へ
    parts.push(line(6.625, 11.531));
    cx += 6.625*s; cy += 11.531*s;

    // rLineTo(6.625, -11.531)  ← 底点から右下へ
    parts.push(line(6.625, -11.531));
    cx += 6.625*s; cy -= 11.531*s;

    // rCubicTo(0.102, -0.151, 0.19, -0.311, 0.281, -0.469)
    parts.push(cubic(0.102, -0.151, 0.19, -0.311, 0.281, -0.469));
    cx += 0.281*s; cy -= 0.469*s;

    // rLineTo(0.063, -0.094)
    parts.push(line(0.063, -0.094));
    cx += 0.063*s; cy -= 0.094*s;

    // rCubicTo(0.649, -1.156, 1.031, -2.485, 1.031, -3.906)
    parts.push(cubic(0.649, -1.156, 1.031, -2.485, 1.031, -3.906));
    cx += 1.031*s; cy -= 3.906*s;

    // rCubicTo(0, -4.4183, -3.582, -8, -8, -8)  ← 右から頂点へ戻る
    parts.push(cubic(0, -4.4183, -3.582, -8, -8, -8));

    parts.push("Z");

    return parts.join(" ");
}

// SVG パス文字列用の数値フォーマット（4桁精度、末尾ゼロ除去）
const fmt = (n: number): string => String(parseFloat(n.toFixed(4)));

// Android/iOS と同じレイアウト計算の結果。すべてピクセル空間。
interface IconLayout {
    /** マーカー本体の一辺（= iconSize * scale、Android の canvasSize）。 */
    markerSize: number;
    /** ビットマップ幅（ラベルが広い場合はマーカーより横に広がる）。 */
    bitmapWidth: number;
    /** ビットマップ高さ（= markerSize）。 */
    bitmapHeight: number;
    /** マーカーを中央寄せするための水平オフセット。 */
    markerOffsetX: number;
    /** ラベルのアウトライン幅（Android: max(1*scale, 2)）。 */
    outlineStroke: number;
}

// ラベル幅測定用の使い回しキャンバス（ブラウザのみ）。
let measureCanvas: HTMLCanvasElement | null = null;

/** ラベル幅を px で測定する。DOM が無い環境では概算で代替する。 */
function measureLabelWidth(label: string, fontSizePx: number, fontFamily: string): number {
    if (typeof document === "undefined") return label.length * fontSizePx * 0.6;
    measureCanvas ??= document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) return label.length * fontSizePx * 0.6;
    ctx.font = `${fontSizePx}px ${fontFamily}`;
    return ctx.measureText(label).width;
}

/** object-fit: cover 相当で画像を dstRect にセンタークロップ描画する。 */
function drawImageCover(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
): void {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (iw <= 0 || ih <= 0) return;
    const scale = Math.max(dWidth / iw, dHeight / ih);
    const sw = dWidth / scale;
    const sh = dHeight / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dWidth, dHeight);
}

const escapeXml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const toSvgDataUrl = (svg: string): string =>
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

const normalizeHexColor = (color: string): string => {
    const trimmed = color.trim();
    if (trimmed.startsWith("#")) return trimmed;
    return `#${trimmed}`;
};

const createBaseProperties = (options: DefaultMarkerIconOptions = {}): BaseIconProperties => ({
    strokeColor: normalizeHexColor(options.strokeColor ?? DEFAULT_BASE_PROPERTIES.strokeColor),
    strokeWidth: options.strokeWidth ?? DEFAULT_BASE_PROPERTIES.strokeWidth,
    scale: options.scale ?? DEFAULT_BASE_PROPERTIES.scale,
    label: options.label ?? DEFAULT_BASE_PROPERTIES.label,
    labelTextColor:
        options.labelTextColor === undefined
            ? DEFAULT_BASE_PROPERTIES.labelTextColor
            : options.labelTextColor === null
                ? null
                : normalizeHexColor(options.labelTextColor),
    labelTextSize: options.labelTextSize ?? DEFAULT_BASE_PROPERTIES.labelTextSize,
    labelTypeFace: options.labelTypeFace ?? DEFAULT_BASE_PROPERTIES.labelTypeFace,
    labelStrokeColor: normalizeHexColor(options.labelStrokeColor ?? DEFAULT_BASE_PROPERTIES.labelStrokeColor),
    infoAnchor: options.infoAnchor ?? DEFAULT_BASE_PROPERTIES.infoAnchor,
    iconSize: options.iconSize ?? DEFAULT_BASE_PROPERTIES.iconSize,
    debug: options.debug ?? DEFAULT_BASE_PROPERTIES.debug,
});

abstract class AbstractDefaultIcon extends AbstractMarkerIcon {
    readonly anchor: Offset = { x: 0.5, y: 1 };

    protected constructor(protected readonly baseProperties: BaseIconProperties) {
        super();
    }

    get strokeColor(): string {
        return this.baseProperties.strokeColor;
    }

    get strokeWidth(): number {
        return this.baseProperties.strokeWidth;
    }

    get scale(): number {
        return this.baseProperties.scale;
    }

    get label(): string | null {
        return this.baseProperties.label;
    }

    get labelTextColor(): string | null {
        return this.baseProperties.labelTextColor;
    }

    get labelTextSize(): number {
        return this.baseProperties.labelTextSize;
    }

    get labelTypeFace(): string {
        return this.baseProperties.labelTypeFace;
    }

    get labelStrokeColor(): string {
        return this.baseProperties.labelStrokeColor;
    }

    get iconSize(): number {
        return this.baseProperties.iconSize;
    }

    get infoAnchor(): Offset {
        return this.baseProperties.infoAnchor;
    }

    get debug(): boolean {
        return this.baseProperties.debug;
    }

    toBitmapIcon(): BitmapIcon {
        const layout = this.computeLayout();
        return {
            url: toSvgDataUrl(this.createSvg(layout)),
            anchor: this.anchor,
            size: {
                width: layout.bitmapWidth,
                height: layout.bitmapHeight,
            },
        };
    }

    hashCode(): number {
        return hashObj({
            baseProperties: this.baseProperties,
            uniqueProperties: this.getUniqueProperties(),
            type: this.constructor.name,
        });
    }

    /**
     * Android AbstractDefaultIcon.toBitmapIcon() / iOS makeIcon() と同じレイアウト計算。
     * すべてピクセル空間で行い、ラベルが広い場合はビットマップを横に広げてマーカーを
     * 中央寄せする（正方形固定にしない）。ラベルの文字サイズはマーカー scale に追従せず
     * 絶対値（Android/iOS と同じ）。
     */
    protected computeLayout(): IconLayout {
        const markerSize = Math.max(1, Math.round(this.iconSize * this.scale));
        // Android: outlineStrokeWidth = max(dpToPx(1 * iconScale), 2)
        const outlineStroke = Math.max(this.scale, 2);
        let labelWidth = 0;
        if (this.label) {
            labelWidth =
                measureLabelWidth(this.label, Math.max(1, this.labelTextSize), this.labelTypeFace) +
                outlineStroke * 2;
        }
        const padding = markerSize * 0.1;
        const bitmapWidth = Math.max(markerSize, Math.round(labelWidth + padding));
        const bitmapHeight = markerSize;
        const markerOffsetX = (bitmapWidth - markerSize) / 2;
        return { markerSize, bitmapWidth, bitmapHeight, markerOffsetX, outlineStroke };
    }

    protected createSvg(layout: IconLayout): string {
        const { markerSize, bitmapWidth, bitmapHeight, markerOffsetX } = layout;
        const strokeWidth = Math.max(0, this.strokeWidth * this.scale);
        const markerPath = createMarkerPathData(markerSize, this.scale, this.strokeWidth, markerOffsetX);
        const label = this.createLabelSvg(layout);
        const debug = this.debug
            ? `<rect x="0.5" y="0.5" width="${fmt(bitmapWidth - 1)}" height="${fmt(bitmapHeight - 1)}" fill="none" stroke="#000000" stroke-width="1"/>`
            : "";

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${bitmapWidth}" height="${bitmapHeight}" viewBox="0 0 ${bitmapWidth} ${bitmapHeight}">`,
            this.createFillSvg(markerPath, markerSize, markerOffsetX),
            `<path d="${markerPath}" fill="none" stroke="${escapeXml(this.strokeColor)}" stroke-width="${fmt(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`,
            label,
            debug,
            "</svg>",
        ].join("");
    }

    /**
     * ラベル描画。Android drawLabel() と同じく円形部分の中心（markerSize * 0.35）へ
     * 通常ウェイト・絶対サイズで配置し、アウトライン（stroke）を下に敷いてから塗りを重ねる。
     */
    protected createLabelSvg(layout: IconLayout): string {
        if (!this.label) return "";

        const text = escapeXml(this.label);
        const fill = escapeXml(this.labelTextColor ?? "#000000");
        const stroke = escapeXml(this.labelStrokeColor);
        const size = Math.max(1, this.labelTextSize);
        const cx = layout.markerOffsetX + layout.markerSize / 2;
        const cy = layout.markerSize * 0.35;
        const attrs =
            `x="${fmt(cx)}" y="${fmt(cy)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-family="${escapeXml(this.labelTypeFace)}" font-size="${size}"`;
        return [
            `<text ${attrs} fill="none" stroke="${stroke}" stroke-width="${fmt(layout.outlineStroke)}" stroke-linejoin="round" stroke-linecap="round">${text}</text>`,
            `<text ${attrs} fill="${fill}">${text}</text>`,
        ].join("");
    }

    protected abstract createFillSvg(markerPath: string, markerSize: number, markerOffsetX: number): string;

    protected abstract getUniqueProperties(): unknown;
}

export class ColorDefaultIcon extends AbstractDefaultIcon {
    readonly fillColor: string;

    constructor(options: DefaultMarkerIconOptions = {}) {
        super(createBaseProperties(options));
        this.fillColor = normalizeHexColor(options.fillColor ?? DEFAULT_FILL_COLOR);
    }

    copy(options: DefaultMarkerIconOptions = {}): ColorDefaultIcon {
        return new ColorDefaultIcon({
            fillColor: this.fillColor,
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            scale: this.scale,
            label: this.label,
            labelTextColor: this.labelTextColor,
            labelTextSize: this.labelTextSize,
            labelTypeFace: this.labelTypeFace,
            labelStrokeColor: this.labelStrokeColor,
            infoAnchor: this.infoAnchor,
            iconSize: this.iconSize,
            debug: this.debug,
            ...options,
        });
    }

    protected createFillSvg(markerPath: string): string {
        return `<path d="${markerPath}" fill="${escapeXml(this.fillColor)}"/>`;
    }

    protected getUniqueProperties(): unknown {
        return this.fillColor;
    }
}

let imageClipCounter = 0;

export class ImageDefaultIcon extends AbstractDefaultIcon {
    readonly backgroundImage: string | HTMLImageElement;

    constructor(options: ImageDefaultIconOptions) {
        super(createBaseProperties(options));
        this.backgroundImage = options.backgroundImage;
    }

    copy(options: Partial<ImageDefaultIconOptions> = {}): ImageDefaultIcon {
        return new ImageDefaultIcon({
            backgroundImage: this.backgroundImage,
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            scale: this.scale,
            label: this.label,
            labelTextColor: this.labelTextColor,
            labelTextSize: this.labelTextSize,
            labelTypeFace: this.labelTypeFace,
            labelStrokeColor: this.labelStrokeColor,
            infoAnchor: this.infoAnchor,
            iconSize: this.iconSize,
            debug: this.debug,
            ...options,
        });
    }

    /**
     * ロード済みの HTMLImageElement が渡された場合は Canvas で描画して PNG data URL を返す。
     * SVG data URL は「SVG as image」サンドボックスにより内部の <image href="..."> が
     * ブロックされるため、外部 URL を参照する場合は必ず Canvas パスを使用する。
     */
    override toBitmapIcon(): BitmapIcon {
        if (
            this.backgroundImage instanceof HTMLImageElement &&
            this.backgroundImage.complete &&
            this.backgroundImage.naturalWidth > 0
        ) {
            return this.toCanvasBitmapIcon(this.backgroundImage);
        }
        return super.toBitmapIcon();
    }

    private toCanvasBitmapIcon(img: HTMLImageElement): BitmapIcon {
        const layout = this.computeLayout();
        const { markerSize, bitmapWidth, bitmapHeight, markerOffsetX } = layout;
        const canvas = document.createElement("canvas");
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return super.toBitmapIcon();

        // ピクセル空間で描画（createSvg と同じ座標系）
        const markerPath = new Path2D(
            createMarkerPathData(markerSize, this.scale, this.strokeWidth, markerOffsetX),
        );

        // マーカー形状でクリップし、正方形領域へ画像をセンタークロップ（cover）
        ctx.save();
        ctx.clip(markerPath);
        drawImageCover(ctx, img, markerOffsetX, 0, markerSize, markerSize);
        ctx.restore();

        // ストローク（createSvg と同じ計算式）
        const strokeWidth = Math.max(0, this.strokeWidth * this.scale);
        ctx.strokeStyle = this.strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke(markerPath);

        // ラベル（createLabelSvg と同じロジック：円形部分の中心・通常ウェイト・絶対サイズ）
        if (this.label) {
            const fontSize = Math.max(1, this.labelTextSize);
            ctx.font = `${fontSize}px ${this.labelTypeFace}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.strokeStyle = this.labelStrokeColor;
            ctx.lineWidth = layout.outlineStroke;
            const cx = markerOffsetX + markerSize / 2;
            const cy = markerSize * 0.35;
            ctx.strokeText(this.label, cx, cy);
            ctx.fillStyle = this.labelTextColor ?? "#000000";
            ctx.fillText(this.label, cx, cy);
        }

        if (this.debug) {
            this.drawDebugFrame(ctx);
        }

        return {
            url: canvas.toDataURL(),
            anchor: this.anchor,
            size: { width: bitmapWidth, height: bitmapHeight },
        };
    }

    protected createFillSvg(markerPath: string, markerSize: number, markerOffsetX: number): string {
        const href = escapeXml(this.imageSourceUrl());
        const clipId = `marker-fill-${(imageClipCounter += 1)}`;
        return [
            `<defs><clipPath id="${clipId}"><path d="${markerPath}"/></clipPath></defs>`,
            `<image href="${href}" x="${fmt(markerOffsetX)}" y="0" width="${markerSize}" height="${markerSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`,
        ].join("");
    }

    protected getUniqueProperties(): unknown {
        return this.imageSourceUrl();
    }

    private imageSourceUrl(): string {
        if (typeof this.backgroundImage === "string") {
            return this.backgroundImage;
        }
        return this.backgroundImage.currentSrc || this.backgroundImage.src;
    }
}

export type DefaultMarkerIcon = ColorDefaultIcon;
export const DefaultMarkerIcon = ColorDefaultIcon;

export const createDefaultIcon = (): DefaultMarkerIcon => new ColorDefaultIcon();

export const hashDefaultMarkerIcon = (icon: DefaultMarkerIcon): number => hashStr(String(icon.hashCode()));
