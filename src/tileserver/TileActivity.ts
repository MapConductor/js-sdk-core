/**
 * Whether a tiler is busy: taking a list (`route`) or having tiles drawn for
 * the map. The collections' onAddStart / onAddEnd read it, so that an app can
 * show that the map is still drawing after a filter change or a camera move.
 *
 * Counted: several tiles are drawn at once.
 *
 * @internal
 */
export class TileActivity {
    private count = 0;
    private readonly listeners = new Set<(busy: boolean) => void>();

    get active(): boolean { return this.count > 0; }

    begin(): void {
        if (++this.count === 1) this.emit(true);
    }

    end(): void {
        if (this.count > 0 && --this.count === 0) this.emit(false);
    }

    async during<T>(work: () => Promise<T>): Promise<T> {
        this.begin();
        try {
            return await work();
        } finally {
            this.end();
        }
    }

    /** Calls `listener` at each change of {@link active}; returns the unsubscribe. */
    subscribe(listener: (busy: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit(busy: boolean): void {
        for (const listener of [...this.listeners]) listener(busy);
    }
}
