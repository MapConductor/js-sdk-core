type Observable = { subscribe: (fn: (fp: unknown) => void) => () => void };
type WithObservable = { asObservable?: () => Observable };

export class OverlayCollector<S extends { id: string }> {
    private readonly map = new Map<string, S>();
    private readonly subs = new Set<(map: ReadonlyMap<string, S>) => void>();
    private updateHandler: ((state: S) => void) | null = null;
    private readonly updateSubs = new Map<string, () => void>();

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
        this.subs.forEach(fn => fn(this.map));
    }
}
