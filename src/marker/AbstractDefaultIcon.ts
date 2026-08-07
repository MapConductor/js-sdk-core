import { hashObj } from "../features/hash-utils";
import { Offset } from "../types";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";

/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */
import { type BaseIconProperties } from "./DefaultIconTypes";
import {
    createMarkerPathData,
    escapeXml,
    measureLabelWidth,
    fmt,
    toSvgDataUrl,
    type IconLayout,
} from "./DefaultIconGeometry";

/**
 * 既定マーカーアイコンの土台。ピン形の輪郭・ラベル・寸法の計算を受け持ち、
 * 中身の塗り方だけをサブクラスに任せる。
 */

export abstract class AbstractDefaultIcon extends AbstractMarkerIcon {
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
