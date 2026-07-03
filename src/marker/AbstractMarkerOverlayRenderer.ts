import { createGeoPoint, GeoPoint } from "../features";
import { MapViewHolder } from "../map";
import { Earth } from "../projection";
import { Settings } from "../settings";
import { createOffset, Offset } from "../types";
import { MarkerAnimation } from "./MarkerAnimation";
import { MarkerEntity } from "./MarkerEntity";
import { AddParams, ChangeParams, MarkerOverlayRenderer } from "./MarkerOverlayRenderer";
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

const androidBounce = (time: number): number => time * time * 8.0;

const bounceInterpolation = (time: number): number => {
    const t = time * 1.1226;
    if (t < 0.3535) return androidBounce(t);
    if (t < 0.7408) return androidBounce(t - 0.54719) + 0.7;
    if (t < 0.9644) return androidBounce(t - 0.8526) + 0.9;
    return androidBounce(t - 1.0435) + 0.95;
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

    onAnimate(entity: MarkerEntity<ActualMarker>): Promise<void> {
        const animation = entity.state.getAnimation();

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
