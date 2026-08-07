/**
 * Typed key for registering and retrieving map-scoped services (plugins).
 * Mirrors `MapServiceKey` from `MapServiceRegistry.kt`.
 */
export interface MapServiceKey<T> {
    readonly __brand: T;
}

export function createMapServiceKey<T>(): MapServiceKey<T> {
    return {} as MapServiceKey<T>;
}

export interface MapServiceRegistry {
    get<T>(key: MapServiceKey<T>): T | null;
}

export class MutableMapServiceRegistry implements MapServiceRegistry {
    private readonly services = new Map<MapServiceKey<unknown>, unknown>();

    put<T>(key: MapServiceKey<T>, value: T): void {
        this.services.set(key as MapServiceKey<unknown>, value);
    }

    get<T>(key: MapServiceKey<T>): T | null {
        return (this.services.get(key as MapServiceKey<unknown>) as T) ?? null;
    }

    /**
     * 登録済みのサービスを1件だけ取り消す。未登録のキーを渡しても何も起きない。
     *
     * {@link clear} がレジストリ全体を空にするのに対し、こちらは他の capability を
     * 残したまま1つだけ取り下げたいプラグイン向け。android-sdk の
     * `MutableMapServiceRegistry.remove` / ios-sdk の `remove(_:)` と同じ意味論。
     */
    remove<T>(key: MapServiceKey<T>): void {
        this.services.delete(key as MapServiceKey<unknown>);
    }

    clear(): void {
        this.services.clear();
    }
}

export const EmptyMapServiceRegistry: MapServiceRegistry = {
    get: () => null,
};
