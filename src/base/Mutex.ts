export class Mutex {
    private locked = false;
    private queue: Array<() => void> = [];

    async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try { return await fn(); } finally { this.release(); }
    }

    private acquire(): Promise<void> {
        if (!this.locked) { this.locked = true; return Promise.resolve(); }
        return new Promise((r) => this.queue.push(r));
    }

    private release(): void {
        const next = this.queue.shift();
        if (next) next(); else this.locked = false;
    }
}