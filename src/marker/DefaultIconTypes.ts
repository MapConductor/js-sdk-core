import { Settings } from "../settings";
import { Offset } from "../types";

/**
 * Android ColorDefaultIcon / iOS ColorDefaultIcon の名前付きコンストラクタ引数に対応する
 * オプション群（fillColor を含む全パラメータを 1 つのオブジェクトで受ける）。
 * `labelTypeFace` は Android の Typeface / iOS の UIFont に対応する Web の font-family 文字列。
 */

/**
 * ラベルをピンに対してどこへ置くか。CSS の `background-position` と同じ書き方で、
 * 横（left / center / right）と縦（top / center / bottom）のキーワードを空白区切りで並べる。
 * 順序は問わず、片方だけなら残りは `center`。
 *
 * - `left` / `right` はピンの外側に置き、縦はピンの上端・頭の中心・先端に揃える。
 * - `center` 列の `top` / `bottom` はピンの上・下の外側に置く。
 * - `"center center"`（既定）はピンの頭の中に重ねる（従来どおり）。
 */
export type MarkerLabelHorizontalPosition = "left" | "center" | "right";
export type MarkerLabelVerticalPosition = "top" | "center" | "bottom";
export type MarkerLabelPosition =
    | MarkerLabelHorizontalPosition
    | MarkerLabelVerticalPosition
    | `${MarkerLabelHorizontalPosition} ${MarkerLabelVerticalPosition}`
    | `${MarkerLabelVerticalPosition} ${MarkerLabelHorizontalPosition}`;

/**
 * 既定マーカーアイコンの見た目を決めるオプションと、その既定値。
 *
 * `BaseIconProperties` は「ピンの形と共通の装飾」を表し、塗り方（単色か画像か）だけが
 * サブクラスで変わる。オプションから内部表現へ落とすのが `createBaseProperties`。
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
    labelPosition?: MarkerLabelPosition;
    infoAnchor?: Offset;
    iconSize?: number;
    debug?: boolean;
}

/** ImageDefaultIcon のコンストラクタ引数。backgroundImage は必須。 */
export interface ImageDefaultIconOptions extends DefaultMarkerIconOptions {
    backgroundImage: string | HTMLImageElement;
}

export interface BaseIconProperties {
    strokeColor: string;
    strokeWidth: number;
    scale: number;
    label: string | null;
    labelTextColor: string | null;
    labelTextSize: number;
    labelTypeFace: string;
    labelStrokeColor: string;
    labelPosition: MarkerLabelPosition;
    infoAnchor: Offset;
    iconSize: number;
    debug: boolean;
}

export const DEFAULT_FILL_COLOR = "#FF0000";
export const DEFAULT_LABEL_TYPE_FACE = "sans-serif";

export const DEFAULT_BASE_PROPERTIES: BaseIconProperties = {
    strokeColor: "#FFFFFF",
    strokeWidth: Settings.Default.iconStroke,
    scale: 1,
    label: null,
    labelTextColor: "#000000",
    labelTextSize: 18,
    labelTypeFace: DEFAULT_LABEL_TYPE_FACE,
    labelStrokeColor: "#FFFFFF",
    labelPosition: "center center",
    infoAnchor: { x: 0.5, y: 0 },
    iconSize: Settings.Default.iconSize,
    debug: false,
};

// Android DefaultMarkerIcon.kt createMarkerPath() の移植。
// originalSize はパスの設計座標系における基準サイズ（ストローク余白を含む）。
