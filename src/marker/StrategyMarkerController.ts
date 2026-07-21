import { GeoPoint, GeoRectBounds } from "../features";
import type { OverlayController } from "../controller/OverlayController";
import { MapCameraPosition, Offset } from "../types";
import { Settings } from "../settings";
import { Mutex } from "../base/Mutex";
import { createDefaultIcon } from "./DefaultMarkerIcon";
import { MarkerEntity } from "./MarkerEntity";
import { MarkerManager } from "./MarkerManager";
import { MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
import { MarkerRenderingStrategy } from "./MarkerRenderingStrategy";
import { MarkerState } from "./MarkerState";
import { OnMarkerEventHandler } from "./OnMarkerEventHandler";

/**
 * Strategy-driven marker controller.
 *
 * Mirrors `StrategyMarkerController.kt` (android-sdk-core) /
 * `StrategyMarkerController.swift` (ios-sdk-core): camera bounds are remembered
 * via `lastKnownBounds` so add/update keep working between camera events, states
 * received before the first camera fix are queued in `pendingStates`, and
 * `find()` hit-tests the tapped point against the nearest marker's icon bounds
 * with `Settings.Default.tapTolerance`.
 */
export class StrategyMarkerController<ActualMarker>
    implements OverlayController<MarkerState, MarkerEntity<ActualMarker>, MarkerState>
{
    readonly markerManager: MarkerManager<ActualMarker>;
    readonly zIndex: number = 10;
    private mapCameraPosition: MapCameraPosition | null = null;
    private lastKnownBounds: GeoRectBounds | null = null;
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
        const bounds = this.mapCameraPosition?.visibleRegion?.bounds ?? this.lastKnownBounds;
        if (bounds == null) {
            this.pendingStates = data;
            return;
        }
        await this.semaphore.withLock(async () => {
            await this.strategy.onAdd({ data, viewport: bounds, renderer: this.renderer });
        });
    }

    async update(state: MarkerState): Promise<void> {
        const bounds = this.mapCameraPosition?.visibleRegion?.bounds ?? this.lastKnownBounds;
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
        const nearest = this.strategy.markerManager.findNearest(position);
        if (nearest == null) return null;

        const holder = this.renderer.holder;
        if (holder == null) return nearest;

        const touchScreen = this.resolveSyncOffset(holder.toScreenOffset(position));
        const markerScreen =
            touchScreen === undefined
                ? undefined
                : this.resolveSyncOffset(holder.toScreenOffset(nearest.state.position));
        // Screen projection only resolves asynchronously on this holder; the
        // native icon-bounds hit test needs synchronous offsets, so degrade to
        // the geo-nearest result instead of dropping the hit entirely.
        if (touchScreen === undefined || markerScreen === undefined) return nearest;
        if (touchScreen === null || markerScreen === null) return null;

        // Native multiplies tapTolerance (dp) by the display density; on the
        // web both tolerance and offsets are CSS pixels, so no scaling applies.
        const tolerancePx = Settings.Default.tapTolerance;
        const icon = nearest.state.icon ?? createDefaultIcon();

        const iconWidthPx = icon.iconSize * icon.scale;
        const iconHeightPx = icon.iconSize * icon.scale;
        const anchorX = icon.anchor.x;
        const anchorY = icon.anchor.y;

        const dx = touchScreen.x - markerScreen.x;
        const dy = touchScreen.y - markerScreen.y;

        const left = -anchorX * iconWidthPx - tolerancePx;
        const right = (1.0 - anchorX) * iconWidthPx + tolerancePx;
        const top = -anchorY * iconHeightPx - tolerancePx;
        const bottom = (1.0 - anchorY) * iconHeightPx + tolerancePx;

        return dx >= left && dx <= right && dy >= top && dy <= bottom ? nearest : null;
    }

    /** `undefined` means the holder projects asynchronously (no sync value available). */
    private resolveSyncOffset(
        result: Offset | null | Promise<Offset | null>,
    ): Offset | null | undefined {
        if (result != null && typeof (result as Promise<Offset | null>).then === "function") {
            return undefined;
        }
        return result as Offset | null;
    }

    async onCameraChanged(mapCameraPosition: MapCameraPosition): Promise<void> {
        this.mapCameraPosition = mapCameraPosition;
        const bounds = mapCameraPosition.visibleRegion?.bounds;
        if (bounds != null) this.lastKnownBounds = bounds;
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
