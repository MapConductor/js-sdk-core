import { createGeoPoint, GeoPoint } from "../features";
import { MapViewHolder } from "../map";
import { Earth } from "../projection";
import { Settings } from "../settings";
import { createOffset, Offset } from "../types";
import { MarkerAnimation } from "./MarkerAnimation";
import { bounceInterpolation, MarkerAnimationOverlayHost } from "./MarkerAnimationOverlay";
import { MarkerEntity } from "./MarkerEntity";
import { AddParams, BitmapIcon, ChangeParams, MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
import { OnMarkerEventHandler } from "./OnMarkerEventHandler";

const nextAnimationFrame = (): Promise<void> =>
    new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => resolve());
            return;
        }
        setTimeout(resolve, 16);
    });

const now = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const FALLBACK_BITMAP_ICON: BitmapIcon = {
    url:
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
                '<circle cx="12" cy="12" r="10" fill="#FF0000" stroke="#FFFFFF" stroke-width="2"/></svg>',
        ),
    anchor: { x: 0.5, y: 0.5 },
    size: { width: 24, height: 24 },
};

export abstract class AbstractMarkerOverlayRenderer<
    MapViewHolderType extends MapViewHolder<unknown, unknown>,
    ActualMarker,
> implements MarkerOverlayRenderer<ActualMarker> {

    abstract onAdd(data: AddParams[]): Promise<(ActualMarker | null)[]>
    abstract onChange(data: ChangeParams<ActualMarker>[]): Promise<(ActualMarker | null)[]>
    abstract onRemove(data: MarkerEntity<ActualMarker>[]): Promise<void>
    abstract onPostProcess(): Promise<void>

    animateStartListener: OnMarkerEventHandler | null = null
    animateEndListener: OnMarkerEventHandler | null = null
    animationOverlayHost: MarkerAnimationOverlayHost | null = null

    /**
     * Set to `true` by a subclass constructor when the provider can hide its
     * native marker (see `setMarkerVisible`) so animation can be delegated to
     * a screen-space overlay instead of interpolating geo coordinates.
     * Mirrors Android's `AbstractMarkerOverlayRenderer.supportsAnimationOverlay`.
     */
    protected supportsAnimationOverlay = false;

    public readonly holder: MapViewHolderType;
    public readonly dropAnimateDuration: number;
    public readonly bounceAnimateDuration: number;

    constructor({
        holder,
        dropAnimateDuration = Settings.Default.markerDropAnimateDuration,
        bounceAnimateDuration = Settings.Default.markerBounceAnimateDuration,
    }: {
        holder: MapViewHolderType;
        dropAnimateDuration?: number;
        bounceAnimateDuration?: number;
    }) {
        this.holder = holder;
        this.dropAnimateDuration = dropAnimateDuration;
        this.bounceAnimateDuration = bounceAnimateDuration;
    }
    
    abstract setMarkerPosition(
        markerEntity: MarkerEntity<ActualMarker>,
        position: GeoPoint,
    ): void

    /** Toggle native marker visibility. Overridden by providers that support the animation overlay. */
    setMarkerVisible(_markerEntity: MarkerEntity<ActualMarker>, _visible: boolean): void {
        // no-op by default: providers without overlay support never hide the native marker
    }

    onAnimate(entity: MarkerEntity<ActualMarker>): Promise<void> {
        const animation = entity.state.getAnimation();
        if (animation == null) {
            throw new Error(`No animation is available: ${animation}`);
        }

        const host = this.animationOverlayHost;
        if (this.supportsAnimationOverlay && host != null) {
            return this.animateOnOverlay(entity, animation, host);
        }

        switch (animation) {
            case MarkerAnimation.Drop: {
                return this.animateMarkerDrop(entity, this.dropAnimateDuration);
            }
            case MarkerAnimation.Bounce: {
                return this.animateMarkerBounce(entity, this.bounceAnimateDuration);
            }
            default: {
                throw new Error(`No animation is available: ${animation}`);
            }
        }
    }

    /**
     * Instead of interpolating geographic coordinates (which produces wrong
     * directions when the map is tilted, rotated, or rendered as a globe/3D
     * scene), hand the animation to a screen-space overlay: hide the native
     * marker, let the host animate a bitmap of its icon in screen space
     * above the map (re-projecting every frame), then restore the marker.
     * Mirrors Android's `AbstractMarkerOverlayRenderer.animateOnOverlay`.
     */
    private animateOnOverlay(
        entity: MarkerEntity<ActualMarker>,
        animation: MarkerAnimation,
        host: MarkerAnimationOverlayHost,
    ): Promise<void> {
        const durationMillis =
            animation === MarkerAnimation.Drop ? this.dropAnimateDuration : this.bounceAnimateDuration;

        return new Promise((resolve) => {
            this.setMarkerVisible(entity, false);
            this.animateStartListener?.(entity.state);

            host({
                id: entity.state.id,
                state: entity.state,
                bitmapIcon: entity.state.icon?.toBitmapIcon() ?? FALLBACK_BITMAP_ICON,
                animation,
                durationMillis,
                onFinished: () => {
                    this.setMarkerVisible(entity, true);
                    entity.state.animate(null);
                    this.animateEndListener?.(entity.state);
                    resolve();
                },
            });
        });
    }

    zoomToMetersPerPixel(
        zoom: number,
        tileSize: number,
    ): number {
        return Earth.CIRCUMFERENCE_METERS / (tileSize * Math.pow(2.0, zoom))
    }

    async animateMarkerDrop(
        entity: MarkerEntity<ActualMarker>,
        duration: number,
    ): Promise<void> {
        await this.animateFromScreenTop({ entity, duration, interpolate: (time) => time });
    }

    async animateMarkerBounce(
        entity: MarkerEntity<ActualMarker>,
        duration: number,
    ): Promise<void> {
        await this.animateFromScreenTop({ entity, duration, interpolate: bounceInterpolation });
    }

    private async animateFromScreenTop({
        entity,
        duration,
        interpolate,
    }: {
        entity: MarkerEntity<ActualMarker>;
        duration: number;
        interpolate: (time: number) => number;
    }): Promise<void> {
        const target = entity.state.position;
        const screenOffset = await Promise.resolve(this.holder.toScreenOffset(target));
        if (screenOffset == null) return;

        const startPoint = createOffset({ x: screenOffset.x, y: 0 });
        const startLatLng = await this.fromScreenOffset(startPoint);
        if (startLatLng == null) return;

        this.animateStartListener?.(entity.state);

        if (duration <= 0) {
            this.setMarkerPosition(entity, target);
            entity.state.position = target;
            entity.state.animate(null);
            this.animateEndListener?.(entity.state);
            return;
        }

        const startTime = now();
        let progress = 0;
        while (progress < 1) {
            progress = clamp01((now() - startTime) / duration);
            const t = clamp01(interpolate(progress));
            const nextPosition = createGeoPoint({
                latitude: t * target.latitude + (1 - t) * startLatLng.latitude,
                longitude: t * target.longitude + (1 - t) * startLatLng.longitude,
                altitude: t * (target.altitude ?? 0) + (1 - t) * (startLatLng.altitude ?? 0),
            });
            this.setMarkerPosition(entity, nextPosition);
            if (progress >= 1) break;
            await nextAnimationFrame();
        }

        this.setMarkerPosition(entity, target);
        entity.state.position = target;
        entity.state.animate(null);
        this.animateEndListener?.(entity.state);
    }

    private async fromScreenOffset(offset: Offset): Promise<GeoPoint | null> {
        const syncPosition = this.holder.fromScreenOffsetSync(offset);
        if (syncPosition != null) return syncPosition;
        return this.holder.fromScreenOffset(offset);
    }
}
