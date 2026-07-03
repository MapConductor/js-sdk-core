import { GeoPoint } from "../features";
import type { OverlayController } from "../controller/OverlayController";
import { MapCameraPosition } from "../types";
import { MarkerEntity } from "./MarkerEntity";
import { MarkerManager } from "./MarkerManager";
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy";
import { MarkerState } from "./MarkerState";
import { OnMarkerEventHandler } from "./OnMarkerEventHandler";

class Mutex {
    private locked = false;
    private queue: Array<() => void> = [];

    async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.queue.push(resolve));
    }

    private release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.locked = false;
        }
    }
}

export class StrategyMarkerController<ActualMarker>
    implements OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState>
{
    readonly markerManager: MarkerManager<ActualMarker>;
    readonly zIndex: number = 10;
    private mapCameraPosition: MapCameraPosition | null = null;
    private readonly semaphore = new Mutex();
    private pendingStates: MarkerState[] | null = null;

    dragStartListener: OnMarkerEventHandler | null = null;
    dragListener: OnMarkerEventHandler | null = null;
    dragEndListener: OnMarkerEventHandler | null = null;
    animateStartListener: OnMarkerEventHandler | null = null;
    animateEndListener: OnMarkerEventHandler | null = null;

    private readonly strategy: MarkerRenderingStrategy<ActualMarker>;
    private readonly renderer: MarkerOverlayRenderer<ActualMarker>;
    public clickListener: OnMarkerEventHandler | null;

    constructor({
        strategy,
        renderer,
        clickListener = null,
    }: {
        strategy: MarkerRenderingStrategy<ActualMarker>;
        renderer: MarkerOverlayRenderer<ActualMarker>;
        clickListener?: OnMarkerEventHandler | null;
    }) {
        this.strategy = strategy;
        this.renderer = renderer;
        this.clickListener = clickListener;
        this.markerManager = strategy.markerManager;
        this.renderer.animateStartListener = (state) => this.dispatchAnimateStart(state);
        this.renderer.animateEndListener = (state) => this.dispatchAnimateEnd(state);
    }

    dispatchClick(state: MarkerState): void {
        state.onClick?.(state);
        this.clickListener?.(state);
    }

    dispatchDragStart(state: MarkerState): void {
        state.onDragStart?.(state);
        this.dragStartListener?.(state);
    }

    dispatchDrag(state: MarkerState): void {
        state.onDrag?.(state);
        this.dragListener?.(state);
    }

    dispatchDragEnd(state: MarkerState): void {
        state.onDragEnd?.(state);
        this.dragEndListener?.(state);
    }

    dispatchAnimateStart(state: MarkerState): void {
        state.onAnimateStart?.(state);
        this.animateStartListener?.(state);
    }

    dispatchAnimateEnd(state: MarkerState): void {
        state.onAnimateEnd?.(state);
        this.animateEndListener?.(state);
    }

    async add(data: MarkerState[]): Promise<void> {
        const bounds = this.mapCameraPosition?.visibleRegion?.bounds;
        if (bounds == null) {
            this.pendingStates = data;
            return;
        }
        await this.semaphore.withLock(async () => {
            await this.strategy.onAdd({ data, viewport: bounds, renderer: this.renderer });
        });
    }

    async update(state: MarkerState): Promise<void> {
        const bounds = this.mapCameraPosition?.visibleRegion?.bounds;
        if (bounds == null) return;
        await this.semaphore.withLock(async () => {
            await this.strategy.onUpdate({ state, viewport: bounds, renderer: this.renderer });
        });
    }

    async clear(): Promise<void> {
        this.strategy.clear();
    }

    getEntity(id: string): MarkerEntity<ActualMarker> | null {
        return this.strategy.markerManager.getEntity(id);
    }

    find(position: GeoPoint): MarkerEntity<ActualMarker> | null {
        return this.strategy.markerManager.findNearest(position);
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        this.mapCameraPosition = mapCameraPosition;
        await this.semaphore.withLock(async () => {
            await this.strategy.onCameraChanged(mapCameraPosition, this.renderer);
        });
        const pending = this.pendingStates;
        if (pending == null) return;
        this.pendingStates = null;
        await this.add(pending);
    }

    destroy(): void {
        this.strategy.clear();
    }
}
