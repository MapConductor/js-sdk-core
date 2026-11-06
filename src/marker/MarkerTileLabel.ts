import { escapeXml, fmt, measureLabelWidth, toSvgDataUrl } from "./DefaultIconGeometry";
import type { BitmapIcon } from "./MarkerOverlayRenderer";

/**
 * ラベルの書字方向の既定。横書き。
 *
 * `labelWritingMode` は CSS の `writing-mode` と同じ書き方で、`vertical-rl` / `vertical-lr` を
 * 縦書きとして扱う（1 行しかないので左右の違いは出ない）。それ以外は横書き。
 * android-sdk の `AbstractDefaultIcon.labelWritingMode`、ios-sdk の `labelWritingMode` と同じ。
 */
export const DEFAULT_LABEL_WRITING_MODE = "horizontal-tb";

/** @internal */
export function isVerticalWritingMode(mode: string): boolean {
    const normalized = mode.trim().toLowerCase();
    return normalized === "vertical-rl" || normalized === "vertical-lr";
}

/**
 * ラベルの寸法。`width` / `height` は縁取り込み、`contentWidth` は縁取りを除いた字面の幅
 * （横書きは文字列の幅、縦書きは列の幅）。
 *
 * @internal
 */
export interface LabelMetrics {
    width: number;
    height: number;
    contentWidth: number;
}

/** 縦書きの列の幅の下限（em）。細い字だけの列でも、隣の列や点と間を空ける。android-sdk と同じ。 */
const VERTICAL_COLUMN_MIN_EM = 1;

/** 書記素（見た目の 1 文字）ごとに分ける。結合文字やサロゲートペアを割らない。 */
function graphemes(text: string): string[] {
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
    if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    return Array.from(text);
}

/**
 * ラベルの寸法を測る。焼き込み（`AbstractDefaultIcon` / `ImageIcon`）とタイルの両方が
 * ここを通るので、どちらで描いても同じ大きさになる。
 *
 * @internal
 */
export function measureLabel(
    text: string,
    fontSize: number,
    typeFace: string,
    outline: number,
    vertical: boolean,
): LabelMetrics {
    if (!vertical) {
        const width = measureLabelWidth(text, fontSize, typeFace);
        return { width: width + outline * 2, height: fontSize + outline * 2, contentWidth: width };
    }
    const glyphs = graphemes(text);
    let column = 0;
    for (const glyph of glyphs) column = Math.max(column, measureLabelWidth(glyph, fontSize, typeFace));
    column = Math.ceil(Math.max(column, fontSize * VERTICAL_COLUMN_MIN_EM));
    return { width: column + outline * 2, height: glyphs.length * fontSize + outline * 2, contentWidth: column };
}

/** @internal */
export interface LabelStyle {
    text: string;
    fontSize: number;
    typeFace: string;
    textColor: string;
    strokeColor: string;
    outline: number;
    vertical: boolean;
}

/**
 * 中心 (`cx`, `cy`) に置くラベルの SVG。縁取りを先に、塗りを後に重ねる。
 *
 * 縦書きは SVG の `writing-mode` に任せる。長音の「ー」は縦棒に、小書きの「ョ」は縦書きの
 * 位置になる（android-sdk は OpenType の `vert`、ios-sdk は CoreText の縦組みで同じ字面を出す）。
 *
 * @internal
 */
export function labelSvgElements(style: LabelStyle, cx: number, cy: number): string {
    const text = escapeXml(style.text);
    const size = Math.max(1, style.fontSize);
    const writing = style.vertical ? ` writing-mode="vertical-rl"` : "";
    const attrs =
        `x="${fmt(cx)}" y="${fmt(cy)}" text-anchor="middle" dominant-baseline="central"${writing} ` +
        `font-family="${escapeXml(style.typeFace)}" font-size="${size}"`;
    return [
        `<text ${attrs} fill="none" stroke="${escapeXml(style.strokeColor)}" stroke-width="${fmt(style.outline)}" stroke-linejoin="round" stroke-linecap="round">${text}</text>`,
        `<text ${attrs} fill="${escapeXml(style.textColor)}">${text}</text>`,
    ].join("");
}

/**
 * タイルに描くとき、アイコン本体とは別に描くラベル。
 *
 * ## なぜ分けるか
 *
 * ラベルを焼き込んだ画像は、文字列と置き場所の組の数だけ要る。街路樹のように「樹種 × 向き」で
 * ラベルを付け替えると、そのたびに本体ごと画像を作り直すことになる。本体（点やピン）と文字を
 * 別の画像にし、文字はタイルで本体をすべて描いたあとに重ねれば、ほかの点の下に字が隠れず、
 * 本体の画像は種類の数だけで済む。
 *
 * android-sdk / ios-sdk はタイルに文字を直接描く。Canvas には縦組みが無いので、web は SVG の
 * 画像にしてから描く（Service Worker へも画像として渡せる）。
 *
 * 長さはすべてアイコンのビットマップの px（`BitmapIcon.size` と同じ単位）。タイルではさらに
 * 描画倍率を掛ける。
 *
 * @internal
 */
export interface MarkerTileLabel {
    /** ラベルだけの画像（SVG のデータ URL）。 */
    url: string;
    width: number;
    height: number;
    /** ラベルの中心の、アンカー点からのずれ。 */
    centerOffsetX: number;
    centerOffsetY: number;
}

/**
 * 本体とラベルの組。ラベルを本体と分けて描けるアイコン（`AbstractDefaultIcon` / `ImageIcon`）が返す。
 *
 * @internal
 */
export interface MarkerTileParts {
    body: BitmapIcon;
    label: MarkerTileLabel | null;
}

/**
 * ラベルだけの画像を作る。
 *
 * @internal
 */
export function createTileLabel(
    style: LabelStyle,
    metrics: LabelMetrics,
    centerOffsetX: number,
    centerOffsetY: number,
): MarkerTileLabel {
    const width = Math.max(1, Math.ceil(metrics.width));
    const height = Math.max(1, Math.ceil(metrics.height));
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        labelSvgElements(style, width / 2, height / 2),
        "</svg>",
    ].join("");
    return { url: toSvgDataUrl(svg), width, height, centerOffsetX, centerOffsetY };
}

/**
 * 本体とラベルを分けて渡せるアイコンなら、その 2 つ。それ以外は null。
 *
 * @internal
 */
export function tilePartsOf(icon: unknown): MarkerTileParts | null {
    const candidate = icon as { tileParts?: () => MarkerTileParts | null } | null | undefined;
    return typeof candidate?.tileParts === "function" ? candidate.tileParts() : null;
}
