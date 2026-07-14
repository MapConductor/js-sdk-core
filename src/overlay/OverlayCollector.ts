type Observable = { subscribe: (fn: (fp: unknown) => void) => () => void };
type WithObservable = { asObservable?: () => Observable };

export class OverlayCollector<S extends { id: string }> {
    private readonly map = new Map<string, S>();
    private readonly subs = new Set<(map: ReadonlyMap<string, S>) => void>();
    private updateHandler: ((state: S) => void) | null = null;
    private readonly updateSubs = new Map<string, () => void>();
    private batchDepth = 0;

    add(state: S): void {
        const prev = this.map.get(state.id);
        if (prev && prev !== state) this.stopUpdateSub(state.id);
        this.map.set(state.id, state);
        if (!this.updateSubs.has(state.id)) this.startUpdateSub(state);
        this.notify();
    }

    remove(id: string): void {
        if (this.map.delete(id)) {
            this.stopUpdateSub(id);
            this.notify();
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
     * Per-state update handlers are suppressed while the batch is active;
     * composition subscribers receive the final collection exactly once.
     */
    batchChanges(action: () => void): void {
        this.batchDepth++;
        try {
            action();
        } finally {
            this.batchDepth--;
            if (this.batchDepth === 0) this.notifySubscribers();
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
        if (this.map.size === 0) return;
        this.updateSubs.forEach(unsub => unsub());
        this.updateSubs.clear();
        this.map.clear();
        this.notify();
    }

    /**
     * Mirrors Android's ChildCollector.setUpdateHandler.
     * When set, subscribes to each state's asObservable() and calls handler
     * only when the fingerprint actually changes (distinctUntilChanged).
     */
    setUpdateHandler(handler: ((state: S) => void) | null): void {
        this.updateSubs.forEach(unsub => unsub());
        this.updateSubs.clear();
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
        const unsub = observable.subscribe(() => {
            if (this.batchDepth > 0) return;
            this.updateHandler?.(state);
        });
        this.updateSubs.set(state.id, unsub);
    }

    private stopUpdateSub(id: string): void {
        const unsub = this.updateSubs.get(id);
        if (unsub) {
            unsub();
            this.updateSubs.delete(id);
        }
    }

    private notify(): void {
        if (this.batchDepth > 0) return;
        this.notifySubscribers();
    }

    private notifySubscribers(): void {
        this.subs.forEach(fn => fn(this.map));
    }
}
