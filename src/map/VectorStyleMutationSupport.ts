import { createMapServiceKey, type MapServiceKey } from './MapServiceRegistry';
import {
    reverseStyleMutation,
    styleMutationTarget,
    type StyleMutation,
} from './StyleMutation';

/**
 * A map that can be told to change a loaded style in place.
 *
 * Separate from {@link VectorStyleSupport}, which is about making a style
 * *be* the basemap. This one is about changing the one that is already up,
 * without the reload that would otherwise cost every tile on screen and
 * every overlay the app added. A provider declares it under
 * {@link VectorStyleMutationSupportKey}.
 *
 * Not every provider can take every change: MapLibre on iOS exposes its
 * paint properties as typed expressions rather than by name, so a raw
 * style-spec key it has no mapping for cannot be set. That is why
 * {@link apply} answers with what it could not do instead of returning
 * nothing -- a caller that silently assumed success would show a map that is
 * half adjusted and say nothing about it.
 *
 * android-sdk-core and ios-sdk-core carry the same capability.
 */
export interface VectorStyleMutationSupport {
    /**
     * Applies `mutations` to the live style, replacing any set applied
     * before: anything the previous set changed and this one does not is put
     * back the way it was.
     *
     * @returns the mutations that could not be applied, empty when all were.
     */
    apply(mutations: readonly StyleMutation[]): StyleMutation[];
    /** Puts back everything {@link apply} changed. */
    clear(): void;
}

/**
 * {@link VectorStyleMutationSupport} の登録キー。
 *
 * 宣言しないプロバイダは「生きているスタイルは触れない」。スタイル調整は
 * その場合、文書を差し替えるか（地図が読み直す）、ラスター経路で描き直す。
 */
export const VectorStyleMutationSupportKey: MapServiceKey<VectorStyleMutationSupport> =
    createMapServiceKey<VectorStyleMutationSupport>();

/**
 * The bookkeeping every provider's {@link VectorStyleMutationSupport} needs,
 * so no provider has to get it right twice.
 *
 * Two things are easy to miss and both show up as "the adjustment worked,
 * and then stopped":
 *
 * - **Replacing a set has to undo what it drops.** Moving a slider sends a
 *   whole new set each time. A property the new set no longer mentions must
 *   go back to the value the style gave it — and only the mutation knows
 *   that value, because by now the renderer's own idea of it is the one this
 *   put there.
 * - **A style load wipes everything.** The app switching basemap, the
 *   provider reloading, a design change: whatever the reason, the renderer
 *   comes back with the document's own values and nothing this applied. The
 *   provider calls {@link onStyleLoaded} and the whole set goes on again.
 */
export class StyleMutationStore implements VectorStyleMutationSupport {
    private current: readonly StyleMutation[] = [];

    /**
     * @param applyNow puts mutations on the live style and returns the ones
     *   it could not.
     */
    constructor(private readonly applyNow: (mutations: readonly StyleMutation[]) => StyleMutation[]) {}

    apply(mutations: readonly StyleMutation[]): StyleMutation[] {
        const targets = new Set(mutations.map(styleMutationTarget));
        const restores = this.current
            .filter((mutation) => !targets.has(styleMutationTarget(mutation)))
            .map(reverseStyleMutation)
            .filter((mutation): mutation is StyleMutation => mutation !== null);
        this.current = mutations;
        // Restores first: a property moving from one rule's value to no rule
        // at all must pass through the style's own value, not stay on the old
        // one because the new set happened to be applied first.
        //
        // Nothing is logged from here. What could not be applied is the
        // caller's to report -- it has the app's diagnostics callback.
        return this.applyNow([...restores, ...mutations]);
    }

    clear(): void {
        const restores = this.current
            .map(reverseStyleMutation)
            .filter((mutation): mutation is StyleMutation => mutation !== null);
        this.current = [];
        if (restores.length > 0) this.applyNow(restores);
    }

    /**
     * Re-applies everything after the map has loaded a style.
     *
     * The provider calls this from whatever it has that fires on a style
     * being ready (`map.on('styledata')` and friends). Without it an
     * adjustment survives only until the next design change, which is the
     * kind of bug that is found weeks later by someone switching basemap
     * with a slider open.
     */
    onStyleLoaded(): void {
        if (this.current.length > 0) this.applyNow(this.current);
    }

    /** What is applied right now. For tests and diagnostics. */
    get applied(): readonly StyleMutation[] {
        return this.current;
    }
}
