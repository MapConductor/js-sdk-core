import { measureLabelWidth, parseLabelPosition, type IconLayout } from "./DefaultIconGeometry";

/** ラベルを避けて置く、アイコン本体の描かれている範囲（本体の左上を原点とする px）。 */
export interface IconBodyBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface IconLabelLayoutParams {
    /** アイコン本体の一辺（= iconSize * scale）。 */
    markerSize: number;
    scale: number;
    body: IconBodyBounds;
    /** `center center` のときのラベルの縦位置（本体の左上を原点とする px）。 */
    centerY: number;
    label: string | null;
    labelTextSize: number;
    labelTypeFace: string;
    labelPosition: string;
}

/**
 * アイコン本体とラベルの配置を決める。既定のピンと画像アイコンで共通。
 *
 * Android AbstractDefaultIcon.toBitmapIcon() / iOS makeIcon() と同じレイアウト計算。
 * すべてピクセル空間で行い、ラベルが広い場合はビットマップを横に広げて本体を
 * 中央寄せする（正方形固定にしない）。ラベルの文字サイズは scale に追従せず
 * 絶対値（Android/iOS と同じ）。
 *
 * `labelPosition` が中央以外なら、ラベルを本体の外側へ置き、ビットマップを
 * その側へだけ伸ばす。
 */
export function computeIconLabelLayout(params: IconLabelLayoutParams): IconLayout {
    const { markerSize, scale, body, centerY, label } = params;
    // Android: outlineStrokeWidth = max(dpToPx(1 * iconScale), 2)
    const outlineStroke = Math.max(scale, 2);
    const padding = markerSize * 0.1;

    if (!label) {
        return {
            markerSize,
            bitmapWidth: markerSize,
            bitmapHeight: markerSize,
            markerOffsetX: 0,
            markerOffsetY: 0,
            outlineStroke,
            labelCenterX: markerSize / 2,
            labelCenterY: centerY,
            labelWidth: 0,
            labelHeight: 0,
        };
    }

    const fontSize = Math.max(1, params.labelTextSize);
    const labelWidth = measureLabelWidth(label, fontSize, params.labelTypeFace) + outlineStroke * 2;
    const labelHeight = fontSize + outlineStroke * 2;
    const { h, v } = parseLabelPosition(params.labelPosition);
    const gap = Math.max(outlineStroke, markerSize * 0.05);

    // 本体の左上を原点とした座標でラベルの中心を決める。
    let cx = markerSize / 2;
    if (h < 0) cx = body.left - gap - labelWidth / 2;
    else if (h > 0) cx = body.right + gap + labelWidth / 2;

    let cy = centerY;
    if (h !== 0) {
        // 横に置くときは、縦は本体の上端・中間・下端に揃える。
        // ピンで center を頭の中心にすると、ピン全体の中央より上に見える。
        if (v < 0) cy = body.top + labelHeight / 2;
        else if (v > 0) cy = body.bottom - labelHeight / 2;
        else cy = (body.top + body.bottom) / 2;
    } else {
        // 中央列の top / bottom は本体と重ならないよう上下の外側に置く。
        if (v < 0) cy = body.top - gap - labelHeight / 2;
        else if (v > 0) cy = body.bottom + gap + labelHeight / 2;
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
        markerOffsetX = Math.max(0, -minX); // -0 にしない
    }

    const minY = Math.min(0, cy - labelHeight / 2);
    const maxY = Math.max(markerSize, cy + labelHeight / 2);
    const markerOffsetY = Math.max(0, Math.ceil(-minY));
    const bitmapHeight = markerOffsetY + Math.ceil(maxY);

    return {
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
}
