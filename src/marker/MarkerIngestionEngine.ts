import { createMarkerEntity, type MarkerEntity } from "./MarkerEntity";
import { fingerPrintEquals } from "./MarkerState";
import type { MarkerManager } from "./MarkerManager";
import type { MarkerState } from "./MarkerState";
import type {
    AddParams,
    BitmapIcon,
    ChangeParams,
    MarkerOverlayRenderer,
} from "./MarkerOverlayRenderer";

/** 1回の renderer 呼び出しで扱うマーカー数。android-sdk の MARKER_RENDER_BATCH_SIZE と同値。 */
export const MARKER_RENDER_BATCH_SIZE = 500;

export interface MarkerIngestionResult<ActualMarker> {
    /** タイル描画対象の集合が変化したか（タイルの再生成が要る）。 */
    tiledDataChanged: boolean;
    /** 現在タイル描画中のマーカーが1件以上あるか。 */
    hasTiledMarkers: boolean;
    /**
     * アニメーションを開始すべきエンティティ。
     *
     * android-sdk の engine は内部で `renderer.onAnimate` を直接呼ぶが、こちらは呼ばずに返す。
     * React 実装はロックの外で `Promise.all` して同時再生させる必要があるため
     * （スクリーン空間オーバーレイの `onAnimate` はアニメーション終了時に解決するので、
     * ロック内で await すると他のマーカー操作をブロックし、アニメーション同士も直列化する）。
     */
    entitiesToAnimate: MarkerEntity<ActualMarker>[];
}

/** イベントループに1回制御を返す。android-sdk のバッチ間 `yield()` に対応する。 */
const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * マーカー取り込みの共有ロジック。
 *
 * 受け取った `MarkerState` の一覧を `MarkerManager` の現在状態と差分比較し、
 * `MarkerOverlayRenderer` を駆動して `MarkerManager` を更新する。
 *
 * プロバイダ固有のコントローラが差し込めるのは:
 * - 「タイル描画にするか、プロバイダのネイティブマーカーにするか」の判定（`shouldTile`）
 * - タイル済み ID の保持先（`tiledMarkerIds`）
 *
 * タイルオーバーレイそのもの（RasterLayer の state、キャッシュバスティング等）は
 * 引き続きコントローラ側の責務。
 *
 * android-sdk の `MarkerIngestionEngine.ingest` の移植。差分は上記 `entitiesToAnimate` と、
 * android-sdk が engine の外に置いているバッチ分割をこちらは engine 内に持つ点
 * （React 側は `AbstractMarkerController` に非タイル経路が別に無いため）。
 */
export async function ingestMarkers<ActualMarker>(params: {
    data: MarkerState[];
    markerManager: MarkerManager<ActualMarker>;
    renderer: MarkerOverlayRenderer<ActualMarker>;
    defaultMarkerIcon: BitmapIcon;
    tilingEnabled: boolean;
    tiledMarkerIds: Set<string>;
    shouldTile: (state: MarkerState) => boolean;
    onMarkerAdded?: (entity: MarkerEntity<ActualMarker>) => void;
}): Promise<MarkerIngestionResult<ActualMarker>> {
    const {
        data,
        markerManager,
        renderer,
        defaultMarkerIcon,
        tilingEnabled,
        tiledMarkerIds,
        shouldTile,
        onMarkerAdded,
    } = params;

    const previousIds = new Set(markerManager.allEntities().map((entity) => entity.state.id));
    const added: AddParams[] = [];
    const updated: ChangeParams<ActualMarker>[] = [];
    const removedActualMarkers: MarkerEntity<ActualMarker>[] = [];
    const entitiesToAnimate: MarkerEntity<ActualMarker>[] = [];
    let tiledDataChanged = false;

    for (const state of data) {
        const wantsTiled = tilingEnabled && shouldTile(state);

        if (previousIds.has(state.id)) {
            const prevEntity = markerManager.getEntity(state.id)!;
            const wasTiled = tiledMarkerIds.has(state.id);
            previousIds.delete(state.id);

            if (wantsTiled) {
                // 既にタイル済みで実際には変化していないマーカー（無関係な再レンダーで同じ一覧が
                // 再送されただけ等）は、manager への再登録もタイルキャッシュの破棄も要らない。
                // やってしまうと no-op の更新のために可視タイル全部が再描画される。
                const unchanged = wasTiled && fingerPrintEquals(prevEntity.fingerPrint, state.fingerPrint());
                if (!unchanged) {
                    if (!wasTiled) {
                        if (prevEntity.marker != null) removedActualMarkers.push(prevEntity);
                        tiledMarkerIds.add(state.id);
                    }
                    markerManager.registerEntity(
                        createMarkerEntity<ActualMarker>({
                            marker: null,
                            state,
                            visible: prevEntity.visible,
                            isRendered: true,
                            tiling: true,
                        }),
                    );
                    tiledDataChanged = true;
                }
            } else {
                if (wasTiled) {
                    tiledMarkerIds.delete(state.id);
                    tiledDataChanged = true;
                }
                if (!wasTiled && fingerPrintEquals(prevEntity.fingerPrint, state.fingerPrint())) {
                    // 描画結果が変わらないので renderer を往復させない。
                    // android-sdk には無い React 固有の最適化で、非同期 renderer の
                    // 再生成によるちらつきを防ぐ（他のオーバーレイコントローラも同様）。
                    continue;
                }
                updated.push({
                    current: createMarkerEntity<ActualMarker>({
                        marker: prevEntity.marker,
                        state,
                        visible: prevEntity.visible,
                        isRendered: true,
                        tiling: wasTiled,
                    }),
                    bitmapIcon: state.icon?.toBitmapIcon() ?? defaultMarkerIcon,
                    prev: prevEntity,
                });
            }
        } else if (wantsTiled) {
            tiledMarkerIds.add(state.id);
            markerManager.registerEntity(
                createMarkerEntity<ActualMarker>({
                    marker: null,
                    state,
                    visible: true,
                    isRendered: true,
                    tiling: true,
                }),
            );
            tiledDataChanged = true;
        } else {
            added.push({ state, bitmapIcon: state.icon?.toBitmapIcon() ?? defaultMarkerIcon });
        }
    }

    // 残った ID は今回の一覧から消えたもの。
    for (const remainId of previousIds) {
        const removedEntity = markerManager.removeEntity(remainId);
        if (removedEntity == null) continue;
        if (tiledMarkerIds.delete(remainId)) {
            tiledDataChanged = true;
        } else if (removedEntity.marker != null) {
            removedActualMarkers.push(removedEntity);
        }
    }

    if (removedActualMarkers.length > 0) {
        await renderer.onRemove(removedActualMarkers);
        if (removedActualMarkers.length >= MARKER_RENDER_BATCH_SIZE) {
            await yieldToEventLoop();
        }
    }

    for (let i = 0; i < added.length; i += MARKER_RENDER_BATCH_SIZE) {
        const batch = added.slice(i, i + MARKER_RENDER_BATCH_SIZE);
        const actualMarkers = await renderer.onAdd(batch);
        actualMarkers.forEach((actualMarker, index) => {
            if (actualMarker == null) return;
            const entity = createMarkerEntity<ActualMarker>({
                marker: actualMarker,
                state: batch[index].state,
                visible: true,
                isRendered: true,
            });
            markerManager.registerEntity(entity);
            onMarkerAdded?.(entity);
            if (entity.state.getAnimation() != null) entitiesToAnimate.push(entity);
        });
        await yieldToEventLoop();
    }

    for (let i = 0; i < updated.length; i += MARKER_RENDER_BATCH_SIZE) {
        const batch = updated.slice(i, i + MARKER_RENDER_BATCH_SIZE);
        const actualMarkers = await renderer.onChange(batch);
        actualMarkers.forEach((actualMarker, index) => {
            const change = batch[index];
            const entity = createMarkerEntity<ActualMarker>({
                marker: actualMarker ?? change.prev.marker,
                state: change.current.state,
                visible: change.current.visible,
                isRendered: true,
            });
            markerManager.registerEntity(entity);
            if (
                change.prev.fingerPrint.animation !== change.current.fingerPrint.animation &&
                entity.state.getAnimation() != null
            ) {
                entitiesToAnimate.push(entity);
            }
        });
        await yieldToEventLoop();
    }

    if (removedActualMarkers.length > 0 || added.length > 0 || updated.length > 0) {
        await renderer.onPostProcess();
    }

    return {
        tiledDataChanged,
        hasTiledMarkers: tiledMarkerIds.size > 0,
        entitiesToAnimate,
    };
}
