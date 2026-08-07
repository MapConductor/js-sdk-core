import { hashStr } from "../features/hash-utils";
import { BitmapIcon } from "./MarkerOverlayRenderer";

/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */
import { AbstractDefaultIcon } from "./AbstractDefaultIcon";
import {
    createBaseProperties,
    createMarkerPathData,
    drawImageCover,
    escapeXml,
    fmt,
    normalizeHexColor,
} from "./DefaultIconGeometry";
import {
    DEFAULT_FILL_COLOR,
    type DefaultMarkerIconOptions,
    type ImageDefaultIconOptions,
} from "./DefaultIconTypes";

// オプション型は DefaultIconTypes.ts にある。以前からこのモジュール名で公開しているので、
// そのまま再エクスポートして import 元を変えずに済ませる。
export type { DefaultMarkerIconOptions, ImageDefaultIconOptions } from "./DefaultIconTypes";

/**
 * 単色で塗る既定アイコン。`DefaultMarkerIcon` はこれの別名。
 */

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

/**
 * ピンの中に画像を敷く既定アイコン。
 */

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
