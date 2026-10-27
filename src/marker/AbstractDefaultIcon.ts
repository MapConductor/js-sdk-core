import { hashObj } from "../features/hash-utils";
import { Offset } from "../types";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";

/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */
import { type BaseIconProperties, type MarkerLabelPosition } from "./DefaultIconTypes";
import {
    computeMarkerPinBounds,
    createMarkerPathData,
    parseLabelPosition,
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
    private cachedLayout: IconLayout | null = null;

    protected constructor(protected readonly baseProperties: BaseIconProperties) {
        super();
    }

    /**
     * ピン先端の位置（ビットマップに対する割合）。ラベルをピンの横や上に置くと
     * ビットマップが片側へ伸びるので、固定の (0.5, 1) ではなくレイアウトから求める。
     */
    get anchor(): Offset {
        const layout = this.computeLayout();
        return {
            x: (layout.markerOffsetX + layout.markerSize / 2) / layout.bitmapWidth,
            y: (layout.markerOffsetY + layout.markerSize) / layout.bitmapHeight,
        };
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

    get labelPosition(): MarkerLabelPosition {
        return this.baseProperties.labelPosition;
    }

    get iconSize(): number {
        return this.baseProperties.iconSize;
    }

    /**
     * 指定されたままの infoAnchor（ピン本体に対する割合）。`infoAnchor` はビットマップに対する
     * 割合へ直した値なので、ネイティブへ渡して描き直させるときはこちらを使う（二重に変換しない）。
     *
     * @internal
     */
    get requestedInfoAnchor(): Offset {
        return this.baseProperties.infoAnchor;
    }

    /**
     * ビットマップの幅と高さが、ピン本体（iconSize × scale の正方形）の何倍か。
     * ラベルを横や上に置くと 1 を超える。当たり判定がアイコンの実寸を使うためのもの。
     *
     * @internal
     */
    get extentRatio(): { width: number; height: number } {
        const layout = this.computeLayout();
        return {
            width: layout.bitmapWidth / layout.markerSize,
            height: layout.bitmapHeight / layout.markerSize,
        };
    }

    /**
     * 指定値はピン本体に対する割合として扱い、ビットマップに対する割合へ直して返す。
     * ラベルが中央にある限りは指定値と一致する（従来どおり）。
     */
    get infoAnchor(): Offset {
        const layout = this.computeLayout();
        const { x, y } = this.baseProperties.infoAnchor;
        return {
            x: (layout.markerOffsetX + x * layout.markerSize) / layout.bitmapWidth,
            y: (layout.markerOffsetY + y * layout.markerSize) / layout.bitmapHeight,
        };
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
            hitBounds: this.hitBounds(layout),
        };
    }

    /**
     * The pin as drawn — its outline, stroke included — and the label when there
     * is one, as fractions of the bitmap. The bitmap is a square around a pin
     * about two thirds as wide, so taps beside the pin used to count.
     */
    protected hitBounds(layout: IconLayout): NonNullable<BitmapIcon["hitBounds"]> {
        const pin = computeMarkerPinBounds(layout.markerSize, this.scale, this.strokeWidth);
        const halfStroke = Math.max(0, this.strokeWidth * this.scale) / 2;
        let left = layout.markerOffsetX + pin.left - halfStroke;
        let right = layout.markerOffsetX + pin.right + halfStroke;
        let top = layout.markerOffsetY + pin.top - halfStroke;
        let bottom = layout.markerOffsetY + pin.bottom + halfStroke;
        if (layout.labelWidth > 0) {
            left = Math.min(left, layout.labelCenterX - layout.labelWidth / 2);
            right = Math.max(right, layout.labelCenterX + layout.labelWidth / 2);
            top = Math.min(top, layout.labelCenterY - layout.labelHeight / 2);
            bottom = Math.max(bottom, layout.labelCenterY + layout.labelHeight / 2);
        }
        const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
        return {
            left: clamp(left / layout.bitmapWidth),
            top: clamp(top / layout.bitmapHeight),
            right: clamp(right / layout.bitmapWidth),
            bottom: clamp(bottom / layout.bitmapHeight),
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
     *
     * `labelPosition` が中央以外なら、ラベルをピンの輪郭の外側へ置き、ビットマップを
     * その側へだけ伸ばす。アイコンは不変なので結果は 1 回だけ計算して使い回す。
     */
    protected computeLayout(): IconLayout {
        if (this.cachedLayout) return this.cachedLayout;
        const markerSize = Math.max(1, Math.round(this.iconSize * this.scale));
        // Android: outlineStrokeWidth = max(dpToPx(1 * iconScale), 2)
        const outlineStroke = Math.max(this.scale, 2);
        // 円形部分の中心（Android drawLabel() と同じ）。
        const headCenterY = markerSize * 0.35;
        const padding = markerSize * 0.1;

        if (!this.label) {
            this.cachedLayout = {
                markerSize,
                bitmapWidth: markerSize,
                bitmapHeight: markerSize,
                markerOffsetX: 0,
                markerOffsetY: 0,
                outlineStroke,
                labelCenterX: markerSize / 2,
                labelCenterY: headCenterY,
                labelWidth: 0,
                labelHeight: 0,
            };
            return this.cachedLayout;
        }

        const fontSize = Math.max(1, this.labelTextSize);
        const labelWidth = measureLabelWidth(this.label, fontSize, this.labelTypeFace) + outlineStroke * 2;
        const labelHeight = fontSize + outlineStroke * 2;
        const { h, v } = parseLabelPosition(this.labelPosition);
        const pin = computeMarkerPinBounds(markerSize, this.scale, this.strokeWidth);
        const gap = Math.max(outlineStroke, markerSize * 0.05);

        // マーカー本体の左上を原点とした座標でラベルの中心を決める。
        let cx = markerSize / 2;
        if (h < 0) cx = pin.left - gap - labelWidth / 2;
        else if (h > 0) cx = pin.right + gap + labelWidth / 2;

        let cy = headCenterY;
        if (h !== 0) {
            // 横に置くときは、縦はピンの上端・頭の中心・先端に揃える。
            if (v < 0) cy = pin.top + labelHeight / 2;
            else if (v > 0) cy = pin.bottom - labelHeight / 2;
        } else {
            // 中央列の top / bottom はピンと重ならないよう上下の外側に置く。
            if (v < 0) cy = pin.top - gap - labelHeight / 2;
            else if (v > 0) cy = pin.bottom + gap + labelHeight / 2;
        }

        // 横方向。中央なら従来どおり左右対称に広げる（出力を変えない）。
        let bitmapWidth: number;
        let markerOffsetX: number;
        if (h === 0) {
            bitmapWidth = Math.max(markerSize, Math.round(labelWidth + padding));
            markerOffsetX = (bitmapWidth - markerSize) / 2;
        } else {
            const minX = Math.min(0, cx - labelWidth / 2 - padding / 2);
            const maxX = Math.max(markerSize, cx + labelWidth / 2 + padding / 2);
            bitmapWidth = Math.ceil(maxX - minX);
            markerOffsetX = -minX;
        }

        const minY = Math.min(0, cy - labelHeight / 2);
        const maxY = Math.max(markerSize, cy + labelHeight / 2);
        const markerOffsetY = Math.ceil(-minY);
        const bitmapHeight = markerOffsetY + Math.ceil(maxY);

        this.cachedLayout = {
            markerSize,
            bitmapWidth,
            bitmapHeight,
            markerOffsetX,
            markerOffsetY,
            outlineStroke,
            labelCenterX: markerOffsetX + cx,
            labelCenterY: markerOffsetY + cy,
            labelWidth,
            labelHeight,
        };
        return this.cachedLayout;
    }

    protected createSvg(layout: IconLayout): string {
        const { markerSize, bitmapWidth, bitmapHeight, markerOffsetX, markerOffsetY } = layout;
        const strokeWidth = Math.max(0, this.strokeWidth * this.scale);
        const markerPath = createMarkerPathData(
            markerSize,
            this.scale,
            this.strokeWidth,
            markerOffsetX,
            markerOffsetY,
        );
        const label = this.createLabelSvg(layout);
        const debug = this.debug
            ? `<rect x="0.5" y="0.5" width="${fmt(bitmapWidth - 1)}" height="${fmt(bitmapHeight - 1)}" fill="none" stroke="#000000" stroke-width="1"/>`
            : "";

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${bitmapWidth}" height="${bitmapHeight}" viewBox="0 0 ${bitmapWidth} ${bitmapHeight}">`,
            this.createFillSvg(markerPath, markerSize, markerOffsetX, markerOffsetY),
            `<path d="${markerPath}" fill="none" stroke="${escapeXml(this.strokeColor)}" stroke-width="${fmt(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`,
            label,
            debug,
            "</svg>",
        ].join("");
    }

    /**
     * ラベル描画。既定では Android drawLabel() と同じく円形部分の中心（markerSize * 0.35）へ
     * 通常ウェイト・絶対サイズで配置し（位置は computeLayout が決める）、アウトライン（stroke）を下に敷いてから塗りを重ねる。
     */
    protected createLabelSvg(layout: IconLayout): string {
        if (!this.label) return "";

        const text = escapeXml(this.label);
        const fill = escapeXml(this.labelTextColor ?? "#000000");
        const stroke = escapeXml(this.labelStrokeColor);
        const size = Math.max(1, this.labelTextSize);
        const attrs =
            `x="${fmt(layout.labelCenterX)}" y="${fmt(layout.labelCenterY)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-family="${escapeXml(this.labelTypeFace)}" font-size="${size}"`;
        return [
            `<text ${attrs} fill="none" stroke="${stroke}" stroke-width="${fmt(layout.outlineStroke)}" stroke-linejoin="round" stroke-linecap="round">${text}</text>`,
            `<text ${attrs} fill="${fill}">${text}</text>`,
        ].join("");
    }

    protected abstract createFillSvg(
        markerPath: string,
        markerSize: number,
        markerOffsetX: number,
        markerOffsetY: number,
    ): string;

    protected abstract getUniqueProperties(): unknown;
}
