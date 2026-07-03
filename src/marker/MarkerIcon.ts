import { Offset } from "../types";
import { BitmapIcon } from "./MarkerOverlayRenderer";

export interface MarkerIcon {
    scale: number
    anchor: Offset
    iconSize: number
    infoAnchor: Offset
    debug: boolean

    toBitmapIcon(): BitmapIcon
}

export abstract class AbstractMarkerIcon implements MarkerIcon {
    abstract scale: number
    abstract anchor: Offset
    abstract iconSize: number
    abstract infoAnchor: Offset
    abstract debug: boolean

    abstract toBitmapIcon(): BitmapIcon
    
    /**
     * デバッグ用の枠描画
     */
    protected drawDebugFrame(canvas: HTMLCanvasElement | CanvasRenderingContext2D): void {
        const context = canvas instanceof HTMLCanvasElement ? canvas.getContext("2d") : canvas;
        if (!context) return;

        const width = canvas instanceof HTMLCanvasElement ? canvas.width : context.canvas.width;
        const height = canvas instanceof HTMLCanvasElement ? canvas.height : context.canvas.height;
        context.save();
        context.strokeStyle = "#000000";
        context.lineWidth = 1;
        context.strokeRect(0.5, 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
        context.restore();
    }
}
