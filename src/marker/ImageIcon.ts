import { combineHash, hashBool, hashNum } from "../features/hash-utils";
import { Settings } from "../settings";
import { Offset } from "../types";
import { AbstractMarkerIcon } from "./MarkerIcon";
import { BitmapIcon } from "./MarkerOverlayRenderer";

export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface ImageIconOptions {
    iconSize?: number;
    scale?: number;
    anchor?: Offset;
    infoAnchor?: Offset;
    debug?: boolean;
}

// Module-level bitmap icon cache keyed by hashCode
const bitmapIconCache = new Map<number, BitmapIcon>();

// WeakMap-based object identity tracking (equivalent to System.identityHashCode)
const objectIdentityMap = new WeakMap<object, number>();
let objectIdentityCounter = 0;

function getObjectIdentity(obj: object): number {
    let id = objectIdentityMap.get(obj);
    if (id === undefined) {
        id = ++objectIdentityCounter;
        objectIdentityMap.set(obj, id);
    }
    return id;
}

function getImageDimensions(image: ImageSource): { width: number; height: number } {
    if (image instanceof HTMLImageElement) {
        return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
    }
    return { width: image.width, height: image.height };
}

/**
 * 画像ソースの同一性ハッシュを計算する。
 *
 * Android の BitmapDrawable.generationId + identityHashCode に相当する実装で、
 * ピクセルデータのハッシュを避け高速に同一性を判定する。
 */
function getImageIdentity(image: ImageSource): number {
    const { width, height } = getImageDimensions(image);
    const identity = getObjectIdentity(image);
    let result = 17;
    result = (31 * result + width) | 0;
    result = (31 * result + height) | 0;
    result = (31 * result + identity) | 0;
    return result;
}

/**
 * 任意の画像ソース（HTMLImageElement / HTMLCanvasElement / ImageBitmap）を
 * マーカーアイコンとして使用するクラス。
 *
 * Android SDK の ImageIcon に対応する実装。
 */
export class ImageIcon extends AbstractMarkerIcon {
    readonly image: ImageSource;
    readonly iconSize: number;
    readonly scale: number;
    readonly anchor: Offset;
    readonly infoAnchor: Offset;
    readonly debug: boolean;

    constructor(image: ImageSource, options: ImageIconOptions = {}) {
        super();
        this.image = image;
        this.iconSize = options.iconSize ?? Settings.Default.iconSize;
        this.scale = options.scale ?? 1.0;
        this.anchor = options.anchor ?? { x: 0.5, y: 0.5 };
        this.infoAnchor = options.infoAnchor ?? { x: 0.5, y: 0.5 };
        this.debug = options.debug ?? false;
    }

    private getImageIdentity(): number {
        return getImageIdentity(this.image);
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof ImageIcon)) return false;
        return (
            this.getImageIdentity() === other.getImageIdentity() &&
            this.iconSize === other.iconSize &&
            this.scale === other.scale &&
            this.anchor.x === other.anchor.x &&
            this.anchor.y === other.anchor.y &&
            this.infoAnchor.x === other.infoAnchor.x &&
            this.infoAnchor.y === other.infoAnchor.y &&
            this.debug === other.debug
        );
    }

    hashCode(): number {
        let result = this.getImageIdentity();
        result = combineHash(result, hashNum(this.iconSize));
        result = combineHash(result, hashNum(this.scale));
        result = combineHash(result, hashNum(this.anchor.x));
        result = combineHash(result, hashNum(this.anchor.y));
        result = combineHash(result, hashNum(this.infoAnchor.x));
        result = combineHash(result, hashNum(this.infoAnchor.y));
        result = combineHash(result, hashBool(this.debug));
        return result;
    }

    toBitmapIcon(): BitmapIcon {
        const id = this.hashCode();
        const cached = bitmapIconCache.get(id);
        if (cached) return cached;

        const scaledSize = Math.max(1, Math.round(this.iconSize * this.scale));
        const canvas = document.createElement("canvas");
        canvas.width = scaledSize;
        canvas.height = scaledSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("ImageIcon: Failed to get 2D context");

        ctx.drawImage(this.image as CanvasImageSource, 0, 0, scaledSize, scaledSize);

        if (this.debug) {
            this.drawDebugFrame(ctx);
        }

        const result: BitmapIcon = {
            url: canvas.toDataURL(),
            anchor: this.anchor,
            size: { width: scaledSize, height: scaledSize },
        };
        bitmapIconCache.set(id, result);
        return result;
    }
}
