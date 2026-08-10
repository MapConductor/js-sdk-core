import type { GeoPointInterface } from '../features/GeoPoint';
import { isSlottedOverlayController, type OverlayControllerLike, type SlottedOverlayController } from './OverlayController';
import type { OverlayKind } from './OverlayKind';

/**
 * {@link OverlayHitResolver.resolve} が返す「当たり」。
 *
 * 配送は {@link dispatch} を呼ぶまで起きない。解決した時点では何の副作用も無い。
 *
 * @internal ドライバー実装点。
 */
export interface OverlayHit {
    /** 当たったオーバーレイの種別。 */
    readonly kind: OverlayKind;
    /**
     * アプリへ渡すクリック座標。
     *
     * ポリラインだけ「線上の最近傍点」で、他はタップ点そのもの。
     * `[-180,180]` への正規化は各コントローラの `dispatchClick` が行う。
     */
    readonly clicked: GeoPointInterface;
    /** `state.onClick` と非推奨のコントローラリスナーへ配送する。 */
    dispatch(): void;
}

/** {@link OverlayHit} を作る。 */
export function createOverlayHit(
    kind: OverlayKind,
    clicked: GeoPointInterface,
    deliver: () => void,
): OverlayHit {
    return { kind, clicked, dispatch: deliver };
}

/**
 * マーカーを除いた正準順。
 *
 * マーカーがここに無いのは「順序の外」という意味ではなく、
 * **判定手段が違う**（地理座標ではなく画面座標での矩形判定）ため。
 * 実際の全体順序は marker → circle → groundImage → polyline → polygon → map。
 */
export const CANONICAL_ORDER: readonly OverlayKind[] = [
    'circle',
    'groundImage',
    'polyline',
    'polygon',
] as const;

/**
 * タップ座標から「どのオーバーレイに当たったか」を、正準順で 1 つだけ決める。
 *
 * 13 プロバイダが同じ 40〜50 行のカスケードを各自持っていたものの集約。
 * **しかも順序が揃っていなかった**（Azure Maps は circle → polyline → polygon →
 * groundImage、他は circle → groundImage → polyline → polygon）。ここで 1 本にする。
 *
 * ## 決めているのは「順序」と「先勝ち」だけ
 *
 * 当たり判定そのものは各 Manager（`PolygonManager` 等）が既にコアで持っている。
 * 重複していたのは常に**それを呼ぶ配線**の側なので、ここで畳む。
 *
 * ## ポリラインだけ配送座標がタップ点ではない
 *
 * ポリラインは「線上の最近傍点」を {@link OverlayHit.clicked} にする。線の上をきっかり
 * タップすることはないので、タップ点をそのまま返すと線から外れた座標がアプリへ渡る。
 * 3 プラットフォーム共通の既存契約。
 *
 * ## 当たらなかったコントローラには何もしない
 *
 * `find` は副作用を持たない。当たった 1 つだけを {@link OverlayHit} にして返し、
 * 配送は呼び出し側が {@link OverlayHit.dispatch} で行う。
 *
 * @internal ドライバー実装点。
 */
export const OverlayHitResolver = {
    CANONICAL_ORDER,

    /**
     * `order` の種別順に登録済みコントローラを試し、最初に `probe` が非 null を返したものを返す。
     *
     * 同じ種別に複数のコントローラが登録されていることがある（マーカークラスタリングは
     * marker 種別で追加登録する）ので、種別の中では登録順に見る。
     *
     * スロットに参加していないコントローラ（カメラ購読のためだけに登録する拡張モジュール等）は
     * 種別を持たないので対象外。
     */
    firstHit<T>(
        controllers: readonly OverlayControllerLike[],
        order: readonly OverlayKind[],
        probe: (controller: OverlayControllerLike & SlottedOverlayController) => T | null,
    ): T | null {
        const slotted = controllers.filter(isSlottedOverlayController);
        for (const kind of order) {
            for (const controller of slotted) {
                if (controller.kind !== kind) continue;
                const hit = probe(controller);
                if (hit != null) return hit;
            }
        }
        return null;
    },

    /**
     * `position` のタップが当たったオーバーレイを 1 つ返す。当たらなければ null。
     *
     * 種別ごとの当たり判定と配送方法は各コントローラの `resolveTap` が持つ。
     * ここは順序だけを決める。
     */
    resolve(
        controllers: readonly OverlayControllerLike[],
        position: GeoPointInterface,
        order: readonly OverlayKind[] = CANONICAL_ORDER,
    ): OverlayHit | null {
        return OverlayHitResolver.firstHit(controllers, order, (controller) =>
            controller.resolveTap?.(position) ?? null,
        );
    },
};
