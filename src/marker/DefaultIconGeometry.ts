
/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */
import { DEFAULT_BASE_PROPERTIES, type BaseIconProperties, type DefaultMarkerIconOptions } from "./DefaultIconTypes";

/**
 * ピン形のパス生成、寸法の割り出し、SVG へ埋める文字列の処理。
 *
 * すべて副作用のない計算。**SVG のデータ URL として組み立てる**のが要点で、
 * canvas を経由しないので Node でも Web Worker でも同じ結果になる。
 * ラベル幅の測定だけは環境依存なので、文字数からの近似で済ませている。
 */
export const MARKER_ORIGINAL_SIZE = { width: 23.5, height: 25.6 } as const;

/**
 * Android AbstractDefaultIcon.createMarkerPath() の移植。
 *
 * @param canvasSize   描画座標系のサイズ（SVG viewBox の場合は 48）
 * @param iconScale    アイコン全体のスケール（this.scale に対応）
 * @param strokeWidth  ストローク幅（スケール適用前の値 this.strokeWidth に対応）
 * @param horizontalOffset  水平オフセット（複数マーカー並置時に使用）
 */
export function createMarkerPathData(
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
export const fmt = (n: number): string => String(parseFloat(n.toFixed(4)));

// Android/iOS と同じレイアウト計算の結果。すべてピクセル空間。
export interface IconLayout {
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
export function measureLabelWidth(label: string, fontSizePx: number, fontFamily: string): number {
    if (typeof document === "undefined") return label.length * fontSizePx * 0.6;
    measureCanvas ??= document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) return label.length * fontSizePx * 0.6;
    ctx.font = `${fontSizePx}px ${fontFamily}`;
    return ctx.measureText(label).width;
}

/** object-fit: cover 相当で画像を dstRect にセンタークロップ描画する。 */
export function drawImageCover(
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

export const escapeXml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

export const toSvgDataUrl = (svg: string): string =>
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

export const normalizeHexColor = (color: string): string => {
    const trimmed = color.trim();
    if (trimmed.startsWith("#")) return trimmed;
    return `#${trimmed}`;
};

export const createBaseProperties = (options: DefaultMarkerIconOptions = {}): BaseIconProperties => ({
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
