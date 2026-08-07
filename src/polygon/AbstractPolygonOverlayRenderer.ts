import { MapViewHolder } from "../map";
import { createPolygonEntity, PolygonEntity } from "./PolygonEntity";
import { PolygonAddParams, PolygonChangeParams, PolygonOverlayRenderer } from "./PolygonOverlayRenderer";
import { PolygonState } from "./PolygonState";
import { resolveHoles } from "./PolygonUnion";

export abstract class AbstractPolygonOverlayRenderer<
    MapViewHolderType extends MapViewHolder<unknown, unknown>,
    ActualPolygon,
> implements PolygonOverlayRenderer<ActualPolygon> {
    constructor(public readonly holder: MapViewHolderType) {}

    abstract removePolygon(entity: PolygonEntity<ActualPolygon>): Promise<void>;
    abstract createPolygon(state: PolygonState): Promise<ActualPolygon | null>;
    abstract updatePolygonProperties(params: {
        polygon: ActualPolygon;
        current: PolygonEntity<ActualPolygon>;
        prev: PolygonEntity<ActualPolygon>;
    }): Promise<ActualPolygon | null>;

    /**
     * 描画に渡す直前に重なった穴を結合する。android-sdk の各 `PolygonOverlayRenderer` が持つ
     * `resolveHoles(state)` と同じ位置づけで、`Polygon.tsx` のコンポーネント段が再実行されない
     * 経路（頂点ドラッグ等での `state.holes` 差し替え）を補う。
     */
    protected resolveHoles(state: PolygonState): PolygonState {
        return resolveHoles(state);
    }

    async onAdd(data: PolygonAddParams[]): Promise<(ActualPolygon | null)[]> {
        return Promise.all(data.map((p) => this.createPolygon(this.resolveHoles(p.state))));
    }

    async onChange(data: PolygonChangeParams<ActualPolygon>[]): Promise<(ActualPolygon | null)[]> {
        return Promise.all(
            data.map((p) => {
                const resolved = this.resolveHoles(p.current.state);
                const current = resolved === p.current.state
                    ? p.current
                    : createPolygonEntity({ polygon: p.current.polygon, state: resolved });
                return this.updatePolygonProperties({
                    polygon: p.prev.polygon,
                    current,
                    prev: p.prev,
                });
            }),
        );
    }

    async onRemove(data: PolygonEntity<ActualPolygon>[]): Promise<void> {
        await Promise.all(data.map((e) => this.removePolygon(e)));
    }

    async onPostProcess(): Promise<void> {}
}
