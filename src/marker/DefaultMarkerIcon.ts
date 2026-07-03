import { hashObj, hashStr } from "../features/hash-utils";
import { Settings } from "../settings";
import { Offset } from "../types";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";

export interface DefaultMarkerIconOptions {
    strokeColor?: string;
    strokeWidth?: number;
    scale?: number;
    label?: string | null;
    labelTextColor?: string | null;
    labelTextSize?: number;
    labelStrokeColor?: string;
    infoAnchor?: Offset;
    iconSize?: number;
    debug?: boolean;
}

interface BaseIconProperties {
    strokeColor: string;
    strokeWidth: number;
    scale: number;
    label: string | null;
    labelTextColor: string | null;
    labelTextSize: number;
    labelStrokeColor: string;
    infoAnchor: Offset;
    iconSize: number;
    debug: boolean;
}

const DEFAULT_BASE_PROPERTIES: BaseIconProperties = {
    strokeColor: "#FFFFFF",
    strokeWidth: Settings.Default.iconStroke,
    scale: 1,
    label: null,
    labelTextColor: "#000000",
    labelTextSize: 18,
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
        const size = Math.max(1, Math.round(this.iconSize * this.scale));
        return {
            url: toSvgDataUrl(this.createSvg(size)),
            anchor: this.anchor,
            size: {
                width: size,
                height: size,
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

    protected createSvg(size: number): string {
        const strokeWidth = Math.max(0, this.strokeWidth * this.scale);
        const markerPath = createMarkerPathData(48, this.scale, this.strokeWidth);
        const label = this.createLabelSvg();
        const debug = this.debug
            ? `<rect x="0.5" y="0.5" width="47" height="47" fill="none" stroke="#000000" stroke-width="1"/>`
            : "";

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">`,
            this.createFillSvg(markerPath),
            `<path d="${markerPath}" fill="none" stroke="${escapeXml(this.strokeColor)}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`,
            label,
            debug,
            "</svg>",
        ].join("");
    }

    protected createLabelSvg(): string {
        if (!this.label) return "";

        const text = escapeXml(this.label);
        const fill = escapeXml(this.labelTextColor ?? "#000000");
        const stroke = escapeXml(this.labelStrokeColor);
        const size = Math.max(1, this.labelTextSize);
        return [
            `<text x="24" y="21" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${size}" font-weight="600" stroke="${stroke}" stroke-width="3" stroke-linejoin="round">${text}</text>`,
            `<text x="24" y="21" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${size}" font-weight="600" fill="${fill}">${text}</text>`,
        ].join("");
    }

    protected abstract createFillSvg(markerPath: string): string;

    protected abstract getUniqueProperties(): unknown;
}

export class ColorDefaultIcon extends AbstractDefaultIcon {
    readonly fillColor: string;

    constructor(fillColor: string = "#FF0000", options: DefaultMarkerIconOptions = {}) {
        super(createBaseProperties(options));
        this.fillColor = normalizeHexColor(fillColor);
    }

    copy(fillColor: string = this.fillColor, options: DefaultMarkerIconOptions = {}): ColorDefaultIcon {
        return new ColorDefaultIcon(fillColor, {
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            scale: this.scale,
            label: this.label,
            labelTextColor: this.labelTextColor,
            labelTextSize: this.labelTextSize,
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

export class ImageDefaultIcon extends AbstractDefaultIcon {
    readonly source: string | HTMLImageElement;

    constructor(source: string | HTMLImageElement, options: DefaultMarkerIconOptions = {}) {
        super(createBaseProperties(options));
        this.source = source;
    }

    copy(source: string | HTMLImageElement = this.source, options: DefaultMarkerIconOptions = {}): ImageDefaultIcon {
        return new ImageDefaultIcon(source, {
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            scale: this.scale,
            label: this.label,
            labelTextColor: this.labelTextColor,
            labelTextSize: this.labelTextSize,
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
            this.source instanceof HTMLImageElement &&
            this.source.complete &&
            this.source.naturalWidth > 0
        ) {
            return this.toCanvasBitmapIcon(this.source);
        }
        return super.toBitmapIcon();
    }

    private toCanvasBitmapIcon(img: HTMLImageElement): BitmapIcon {
        const size = Math.max(1, Math.round(this.iconSize * this.scale));
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return super.toBitmapIcon();

        // SVG viewBox (0 0 48 48) と同じ座標系で描画する
        const s = size / 48;
        ctx.scale(s, s);

        const markerPath = new Path2D(createMarkerPathData(48, this.scale, this.strokeWidth));

        // マーカー形状でクリップして画像を描画
        ctx.save();
        ctx.clip(markerPath);
        ctx.drawImage(img, 0, 0, 48, 48);
        ctx.restore();

        // ストローク（createSvg と同じ計算式）
        const strokeWidth = Math.max(0, this.strokeWidth * this.scale);
        ctx.strokeStyle = this.strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke(markerPath);

        // ラベル（createLabelSvg と同じロジック）
        if (this.label) {
            const fontSize = Math.max(1, this.labelTextSize);
            ctx.font = `600 ${fontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            ctx.strokeStyle = this.labelStrokeColor;
            ctx.lineWidth = 3;
            ctx.strokeText(this.label, 24, 21);
            ctx.fillStyle = this.labelTextColor ?? "#000000";
            ctx.fillText(this.label, 24, 21);
        }

        // drawDebugFrame はピクセル座標を使うのでトランスフォームをリセット
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (this.debug) {
            this.drawDebugFrame(ctx);
        }

        return {
            url: canvas.toDataURL(),
            anchor: this.anchor,
            size: { width: size, height: size },
        };
    }

    protected createFillSvg(markerPath: string): string {
        const href = escapeXml(this.imageSourceUrl());
        return [
            `<defs><clipPath id="marker-fill"><path d="${markerPath}"/></clipPath></defs>`,
            `<image href="${href}" x="0" y="0" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#marker-fill)"/>`,
        ].join("");
    }

    protected getUniqueProperties(): unknown {
        return this.imageSourceUrl();
    }

    private imageSourceUrl(): string {
        if (typeof this.source === "string") {
            return this.source;
        }
        return this.source.currentSrc || this.source.src;
    }
}

export type DefaultMarkerIcon = ColorDefaultIcon;
export const DefaultMarkerIcon = ColorDefaultIcon;

export const createDefaultIcon = (): DefaultMarkerIcon => new ColorDefaultIcon();

export const hashDefaultMarkerIcon = (icon: DefaultMarkerIcon): number => hashStr(String(icon.hashCode()));
