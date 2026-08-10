import { CANONICAL_ORDER } from '../controller/OverlayHitResolver';
import { isSlottedOverlayController, type OverlayControllerLike } from '../controller/OverlayController';
import { OVERLAY_KINDS, type OverlayKind } from '../controller/OverlayKind';
import type { GeoPoint } from '../features/GeoPoint';
import { MAP_CAPABILITIES, isKnownUnsupported } from '../map/MapCapability';
import type { MapServiceRegistry } from '../map/MapServiceRegistry';
import type { Offset } from '../types/Offset';
import { AbstractZoomAltitudeConverter } from '../zoom/AbstractZoomAltitudeConverter';
import type { WebMercatorZoomAltitudeConverter } from '../zoom/WebMercatorZoomAltitudeConverter';

/**
 * 適合していないときに投げる。
 *
 * @internal ドライバー実装点。
 */
export class DriverConformanceViolation extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DriverConformanceViolation';
    }
}

function require_(condition: boolean, message: () => string): void {
    if (!condition) throw new DriverConformanceViolation(message());
}

const ZOOM_TOLERANCE = 1e-6;

// 画面座標は整数に丸められうるので、往復の誤差はズームに比例して残る。
// 1e-5 度 ≒ 1m。投影が「壊れている」ことを見るには十分細かい。
const COORD_TOLERANCE = 1e-5;

/**
 * 地図SDKドライバーの適合チェック。
 *
 * 外部の作者が自分のドライバーのテストから呼んで、コアが前提にしている契約を
 * 満たしているかを機械的に確かめるためのもの。**テストランナーに依存しない**
 * （素の関数と例外だけ）。
 *
 * ```ts
 * test('every overlay kind is slotted', () => {
 *     MapDriverConformance.checkOverlaySlots(controller.overlayControllers);
 * });
 * ```
 *
 * android-sdk の `MapDriverConformance.kt`、ios-sdk の
 * `MapDriverConformance.swift` と同じ 5 つのチェックを持つ。
 *
 * ## ここに入れられないもの
 *
 * マーカーの描画は canvas と実際のビューの大きさに依存する。タップとドラッグは
 * **ブラウザで確かめるしかない**。このチェックが緑でも目視は省略しないこと。
 *
 * @internal ドライバー実装点。
 */
export const MapDriverConformance = {
    /**
     * ズームの往復換算が壊れていないか。
     *
     * ドライバーは SDK の生ズームと統一ズーム（Google 準拠）を相互変換する。
     * ここがずれると、当たり判定の許容量（metersPerPixel × tapTolerance）が
     * 実際の縮尺と食い違い、**線や円をタップしても反応しない**という形で表面化する。
     */
    checkZoomConverter(
        converter: WebMercatorZoomAltitudeConverter,
        latitudes: readonly number[] = [0.0, 35.0, 60.0, 85.0, -85.0],
        zooms: readonly number[] = [0.0, 1.0, 5.5, 10.0, 15.25, 22.0],
    ): void {
        for (const latitude of latitudes) {
            for (const zoom of zooms) {
                const native = converter.toNativeZoom(zoom, latitude);
                const roundTrip = converter.toUnifiedZoom(native, latitude);
                // 端はクランプされるので、クランプ範囲内でのみ往復を要求する。
                const clampedInput = Math.min(
                    Math.max(zoom, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL),
                    AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL,
                );
                if (
                    native > AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL &&
                    native < AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL
                ) {
                    require_(
                        Math.abs(roundTrip - clampedInput) < ZOOM_TOLERANCE,
                        () =>
                            `zoom round-trip failed at zoom=${zoom} latitude=${latitude}: ` +
                            `toNativeZoom=${native} toUnifiedZoom=${roundTrip}`,
                    );
                }
            }
        }

        // 単調性。統一ズームを上げたら生ズームも上がること。
        for (const latitude of latitudes) {
            let previous = Number.NEGATIVE_INFINITY;
            for (let step = 0; step <= 22; step++) {
                const native = converter.toNativeZoom(step, latitude);
                require_(
                    native >= previous,
                    () => `toNativeZoom is not monotonic at latitude=${latitude} (zoom=${step})`,
                );
                previous = native;
            }
        }

        // クランプ。範囲外を渡しても [0, 22] に収まること。
        for (const extreme of [-100.0, 1000.0]) {
            const unified = converter.toUnifiedZoom(extreme);
            require_(
                unified >= AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL &&
                    unified <= AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL,
                () => `toUnifiedZoom(${extreme}) = ${unified} is out of [0, 22]`,
            );
        }
    },

    /**
     * 6 種別すべてがスロットに参加しているか。
     *
     * ## これが最重要のチェック
     *
     * `SlottedOverlayController` を実装し忘れたコントローラは、Capable ファサードと
     * クリックカスケードから**黙って漏れる**。ビルドも apiCheck も既存のテストも
     * 緑のまま、「追加したのに表示されない」「タップしても無反応」という形で出る。
     *
     * **TypeScript は構造的型付けなので、`implements` を書かなくても型は通る。**
     * だからこそ `kind` や `resolveTap` の書き忘れがコンパイルで止まらない。
     * 移行時に調べたところ、**13 プロバイダのどれ 1 つとして
     * `registerOverlayController` を呼んでいなかった**。
     */
    checkOverlaySlots(
        controllers: readonly OverlayControllerLike[],
        expected: readonly OverlayKind[] = OVERLAY_KINDS,
    ): void {
        const declared = new Set(controllers.filter(isSlottedOverlayController).map((c) => c.kind));
        const missing = expected.filter((kind) => !declared.has(kind));
        require_(
            missing.length === 0,
            () =>
                'these overlay kinds are not reachable from the Capable facade or the click cascade: ' +
                `${missing.join(', ')} — the controller is probably not a SlottedOverlayController ` +
                `(registered controllers: ${controllers.length})`,
        );
    },

    /**
     * クリックカスケードの探索順が正準どおりか。
     *
     * ドライバーが `CANONICAL_ORDER` を差し替えている場合に、意図した順に
     * なっているかを確かめる。
     */
    checkCascadeOrder(order: readonly OverlayKind[] = CANONICAL_ORDER): void {
        require_(
            !order.includes('marker'),
            () =>
                'marker must not be in the overlay cascade; it goes through dispatchMarkerTap ' +
                'because the hit test needs screen projection',
        );
        const circle = order.indexOf('circle');
        const polygon = order.indexOf('polygon');
        if (circle >= 0 && polygon >= 0) {
            require_(
                circle < polygon,
                () => `circle must be probed before polygon (small overlays win): ${order.join(' → ')}`,
            );
        }
    },

    /**
     * capability の宣言が意味の通る形か。
     *
     * ## Unknown を非対応と混同しないこと
     *
     * 宣言が無い（`unknown`）は「まだ宣言していない」であって「使えない」ではない。
     * 地図の初期化途中もここに入る。**`unsupported` は「その機能が動かない」ときだけ。**
     * 別経路で動いているなら `degraded` / `approximated` にすること。`unsupported` に
     * すると**コアが動いている機能を止める**。
     */
    checkCapabilityDeclarations(registry: MapServiceRegistry): void {
        for (const capability of MAP_CAPABILITIES) {
            const status = registry.capabilityStatus(capability);
            if (isKnownUnsupported(status)) {
                require_(
                    (status.reason ?? '').trim().length > 0,
                    () =>
                        `${capability} is declared unsupported without a reason; the diagnostic log ` +
                        'would tell the app developer nothing about why the feature stopped',
                );
            }
        }
    },

    /** ホルダーの投影が往復するか。同期変換を持つドライバーだけ呼ぶこと。 */
    checkProjectionRoundTrip(
        toScreen: (position: GeoPoint) => Offset | null,
        fromScreen: (offset: Offset) => GeoPoint | null,
        samples: readonly GeoPoint[],
    ): void {
        for (const point of samples) {
            const screen = toScreen(point);
            if (screen == null) continue;
            const back = fromScreen(screen);
            if (back == null) {
                throw new DriverConformanceViolation(
                    `fromScreenOffsetSync returned null for a point it just projected: ` +
                        `(${point.latitude}, ${point.longitude})`,
                );
            }
            require_(
                Math.abs(back.latitude - point.latitude) < COORD_TOLERANCE &&
                    Math.abs(back.longitude - point.longitude) < COORD_TOLERANCE,
                () =>
                    `projection round-trip failed: (${point.latitude}, ${point.longitude}) -> ` +
                    `(${screen.x}, ${screen.y}) -> (${back.latitude}, ${back.longitude})`,
            );
        }
    },
} as const;
