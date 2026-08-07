import { Settings } from "../settings/Settings";

type Observable = { subscribe: (fn: (fp: unknown) => void) => () => void };
type WithObservable = { asObservable?: () => Observable };

// android-sdk OverlayCollector の debounceBatch と同じ閾値。
// add / remove それぞれ「無入力 5ms」でバーストを確定し、件数が閾値に達したら即フラッシュする。
const ADD_MAX_BATCH = 100;
const REMOVE_MAX_BATCH = 300;

/**
 * Per-map, per-overlay-type source of truth for overlay states.
 *
 * 変更の届け方は 3 プラットフォームで揃えてある。
 *
 * - **membership（add / remove）は debounce**。5ms の無入力窓で、イベントが来るたびに
 *   窓を延長し、件数が閾値に達したら待たずに出す。android-sdk の
 *   `debounceBatch(5ms, 100/300)`、ios-sdk の `scheduleMembership()` と同じ。
 * - **in-place 変更は sample**。1 つの state につき 1 窓 1 回、最新の値だけを配る。
 *   android-sdk の `sample(updateDebounce)`、ios-sdk の `scheduleUpdate()` と同じ。
 *
 * どちらの窓でも、コレクション自体の書き換えは同期のまま（`values()` / `get()` は常に
 * 最新）。遅らせるのは購読者・ハンドラへの通知だけ。
 */
export class OverlayCollector<S extends { id: string }> {
    private readonly map = new Map<string, S>();
    private readonly subs = new Set<(map: ReadonlyMap<string, S>) => void>();
    private updateHandler: ((state: S) => void) | null = null;
    private readonly updateSubs = new Map<string, () => void>();
    private batchDepth = 0;
    private batchDirty = false;

    private pendingAdds = 0;
    private pendingRemoves = 0;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly pendingUpdates = new Map<string, S>();
    private updateTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * `<Marker>` を1つマウントするたびに1回ずつ走っていた composition を、
     * android-sdk の OverlayCollector と同じ窓でまとめる。
     *
     * コレクション自体の書き換えは同期のまま（`values()` / `get()` は常に最新）で、
     * 遅らせるのは購読者への通知だけ。`applyDiff` / `replaceAll` / `clear` は
     * もともと1回しか通知しないバルク操作なので、android-sdk と同じくデバウンス対象外。
     */
    add(state: S): void {
        const prev = this.map.get(state.id);
        if (prev && prev !== state) this.stopUpdateSub(state.id);
        this.map.set(state.id, state);
        if (!this.updateSubs.has(state.id)) this.startUpdateSub(state);
        this.notifyDebounced('add');
    }

    remove(id: string): void {
        if (this.map.delete(id)) {
            this.stopUpdateSub(id);
            this.notifyDebounced('remove');
        }
    }

    /**
     * Applies a batch of upserts and removals with a single notification.
     * Unlike calling add()/remove() in a loop (which notifies subscribers once
     * per call and can trigger an expensive downstream re-render each time),
     * subscribers see the final state exactly once.
     */
    applyDiff(upserts: S[], removeIds: Iterable<string>): void {
        let changed = false;
        for (const id of removeIds) {
            if (this.map.delete(id)) {
                this.stopUpdateSub(id);
                changed = true;
            }
        }
        for (const s of upserts) {
            const prev = this.map.get(s.id);
            if (prev && prev !== s) this.stopUpdateSub(s.id);
            this.map.set(s.id, s);
            if (!this.updateSubs.has(s.id)) this.startUpdateSub(s);
            changed = true;
        }
        if (changed) this.notify();
    }

    /**
     * Applies a group of collection and state mutations as one composition.
     *
     * `<Markers states={...}>` は毎レンダーで「既存 state をその場で書き換える」と
     * 「新しい id を追加し、消えた id を削除する」を同時にやる。素で走らせると:
     *
     * 1. `syncMarkerState` の代入1つごとに state の subject が発火 → `updateHandler` が
     *    1件ずつ呼ばれる（1000件なら最大1000回）
     * 2. そのあと `applyDiff` の membership 通知が1回
     *
     * つまり **membership より先に in-place 更新が飛ぶ**。まだコレクションに入っていない
     * マーカーの更新を受け取ることになり、マーカークラスタリングのように「membership を
     * 見てから作り直す」consumer が壊れる。
     *
     * batchChanges の間は:
     * - in-place 変更は `updateHandler` を呼ばず `batchDirty` を立てるだけ（サンプリング窓
     *   にも積まない）
     * - `notify()` も同じく `batchDirty` を立てるだけ
     * - 抜けるときに dirty なら `notify()` を **1回だけ**
     *
     * 結果、N件の in-place 更新 + membership 変化が購読者への通知1回に畳まれる。捨てられた
     * in-place 更新は失われない: 購読者は通知を受けて `values()` から最新の state を読み直す。
     */
    batchChanges(action: () => void): void {
        this.batchDepth++;
        try {
            action();
        } finally {
            this.batchDepth--;
            if (this.batchDepth === 0 && this.batchDirty) {
                this.batchDirty = false;
                this.notify();
            }
        }
    }

    replaceAll(states: S[]): void {
        const nextIds = new Set(states.map(s => s.id));
        const prevIds = new Set(this.map.keys());
        const prevStates = new Map(this.map);

        for (const id of prevIds) {
            if (!nextIds.has(id)) this.stopUpdateSub(id);
        }

        const idsChanged =
            prevIds.size !== nextIds.size ||
            [...nextIds].some(id => !prevIds.has(id));

        this.map.clear();
        for (const s of states) {
            const prev = prevStates.get(s.id);
            if (prev && prev !== s) this.stopUpdateSub(s.id);
            this.map.set(s.id, s);
            if (!this.updateSubs.has(s.id)) this.startUpdateSub(s);
        }

        if (idsChanged) this.notify();
    }

    clear(): void {
        this.cancelFlushTimer();
        this.cancelPendingUpdates();
        if (this.map.size === 0) return;
        this.updateSubs.forEach(unsub => unsub());
        this.updateSubs.clear();
        this.map.clear();
        this.notify();
    }

    /**
     * Mirrors Android's OverlayCollector.setUpdateHandler.
     * When set, subscribes to each state's asObservable() and calls handler
     * only when the fingerprint actually changes (distinctUntilChanged) — never
     * for the value the subscription replays on registration. Membership
     * changes are delivered to subscribe() listeners, not to this handler.
     */
    setUpdateHandler(handler: ((state: S) => void) | null): void {
        this.updateSubs.forEach(unsub => unsub());
        this.updateSubs.clear();
        this.cancelPendingUpdates();
        this.updateHandler = handler;
        if (handler) {
            for (const state of this.map.values()) {
                this.startUpdateSub(state);
            }
        }
    }

    values(): S[] {
        return Array.from(this.map.values());
    }

    get(id: string): S | undefined {
        return this.map.get(id);
    }

    subscribe(fn: (map: ReadonlyMap<string, S>) => void): () => void {
        this.subs.add(fn);
        fn(this.map);
        return () => { this.subs.delete(fn); };
    }

    private startUpdateSub(state: S): void {
        if (!this.updateHandler) return;
        const observable = (state as unknown as WithObservable).asObservable?.();
        if (!observable) return;
        // A state's subject replays its current value to a new subscriber, and
        // that first emission is a baseline rather than an edit: membership
        // changes reach consumers through notify(), not the update handler.
        // Delivering it breaks any consumer that treats a callback as "this one
        // changed" — marker clustering, for instance, would be fed one marker at
        // a time ahead of the batch add and could never form a cluster.
        //
        // Matches android-sdk's OverlayCollector ("the first emission after a
        // (re)start is recorded as the baseline and not delivered") and
        // ios-sdk's `state.asFlow().dropFirst()`.
        //
        // Only emissions delivered synchronously from subscribe() are dropped,
        // so a state type whose subject has never emitted keeps its first real
        // change.
        let replaying = true;
        const unsub = observable.subscribe(() => {
            if (replaying) return;
            if (this.batchDepth > 0) {
                this.batchDirty = true;
                return;
            }
            this.scheduleUpdate(state);
        });
        replaying = false;
        this.updateSubs.set(state.id, unsub);
    }

    /**
     * 変更を 5ms 窓にためて、窓の終わりに id ごと最新の1件だけ配る。
     *
     * debounce ではなく **sample**（最初の変更で窓を開き、以降は窓を延長しない）なのが
     * 重要で、android-sdk が `sample(updateDebounce)` を使うのと同じ理由。ドラッグは
     * 同じ state を毎フレーム書き換えるので、debounce だと指が止まるまで窓が延び続けて
     * 1回も配信されない。sample なら変更が続いている間も1窓に1回は届く。
     *
     * 以前はここが素通しで、`position` を1回書き換えるたびにプロバイダの
     * `update(state)`（＝ネイティブ SDK の再描画）が走っていた。
     */
    private scheduleUpdate(state: S): void {
        this.pendingUpdates.set(state.id, state);
        if (this.updateTimer != null) return;

        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            // membership 通知が保留中なら先に出す。debounce 窓は延長されうるので、
            // 待っていると購読者がまだ知らない state の update が先着しかねない。
            if (this.flushTimer != null) this.notify();

            const batch = [...this.pendingUpdates.values()];
            this.pendingUpdates.clear();
            for (const s of batch) {
                // 窓の間に外された state には配らない。
                if (this.map.get(s.id) === s) this.updateHandler?.(s);
            }
        }, Settings.Default.composeEventDebounce);
    }

    private cancelPendingUpdates(): void {
        if (this.updateTimer != null) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        this.pendingUpdates.clear();
    }

    private stopUpdateSub(id: string): void {
        this.pendingUpdates.delete(id);
        const unsub = this.updateSubs.get(id);
        if (unsub) {
            unsub();
            this.updateSubs.delete(id);
        }
    }

    private notify(): void {
        if (this.batchDepth > 0) {
            this.batchDirty = true;
            return;
        }
        this.cancelFlushTimer();
        this.pendingAdds = 0;
        this.pendingRemoves = 0;
        this.notifySubscribers();
    }

    private notifyDebounced(kind: 'add' | 'remove'): void {
        if (this.batchDepth > 0) {
            this.batchDirty = true;
            return;
        }
        if (kind === 'add') this.pendingAdds++;
        else this.pendingRemoves++;

        if (this.pendingAdds >= ADD_MAX_BATCH || this.pendingRemoves >= REMOVE_MAX_BATCH) {
            this.notify();
            return;
        }

        // 無入力の窓。イベントが続く限りタイマを延長する（android-sdk の debounceBatch と同じ）。
        this.cancelFlushTimer();
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.notify();
        }, Settings.Default.composeEventDebounce);
    }

    private cancelFlushTimer(): void {
        if (this.flushTimer != null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    private notifySubscribers(): void {
        this.subs.forEach(fn => fn(this.map));
    }
}
