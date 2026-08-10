import { type MapCapability, type MapCapabilityStatus, MapCapabilityStatus as Status } from './MapCapability';

/**
 * Typed key for registering and retrieving map-scoped services (plugins).
 * Mirrors `MapServiceKey` from `MapServiceRegistry.kt`.
 *
 * `capability` を指定すると、そのキーを {@link MutableMapServiceRegistry.put} した時点で
 * 対応状況が自動的に `supported` になる。プロバイダが「登録する」と
 * 「対応していると宣言する」を二重に書かなくて済むようにするため。
 */
export interface MapServiceKey<T> {
    readonly __brand: T;
    readonly capability?: MapCapability;
}

export function createMapServiceKey<T>(capability?: MapCapability): MapServiceKey<T> {
    return { capability } as MapServiceKey<T>;
}

export interface MapServiceRegistry {
    get<T>(key: MapServiceKey<T>): T | null;

    /**
     * キーが登録済みか。{@link get} の null 判定と同じだが、「値が欲しい」のではなく
     * 「対応しているかを知りたい」という意図をコード上で表せる。
     */
    has<T>(key: MapServiceKey<T>): boolean;

    /**
     * `capability` への対応状況。宣言が無ければ `unknown`。
     *
     * **`unknown` を非対応と解釈しないこと。** 初期化途中のマップも unknown を返す。
     */
    capabilityStatus(capability: MapCapability): MapCapabilityStatus;
}

/**
 * 登録の取り消し券。
 *
 * プロバイダも拡張モジュールも、自分が登録したものだけを {@link dispose} で外せる。
 * キー名をどこかにハードコードした撤収処理を不要にするためのもの。新しい capability を
 * 増やしても撤収コードを直す必要がない。
 */
export interface MapServiceRegistration {
    dispose(): void;
}

/** 複数の {@link MapServiceRegistration} をまとめて破棄するための入れ物。 */
export class MapServiceRegistrations {
    private readonly registrations: MapServiceRegistration[] = [];

    add(registration: MapServiceRegistration): MapServiceRegistration {
        this.registrations.push(registration);
        return registration;
    }

    /** 登録した順に関係なくすべて取り消す。二重呼び出しは安全。 */
    disposeAll(): void {
        const snapshot = this.registrations.splice(0, this.registrations.length);
        snapshot.forEach((registration) => registration.dispose());
    }
}

export class MutableMapServiceRegistry implements MapServiceRegistry {
    private readonly services = new Map<MapServiceKey<unknown>, unknown>();
    private readonly capabilities = new Map<MapCapability, MapCapabilityStatus>();

    put<T>(key: MapServiceKey<T>, value: T): void {
        this.register(key, value);
    }

    /**
     * サービスを登録し、取り消し券を返す。
     *
     * `key` が {@link MapServiceKey.capability} を持つ場合、その capability を
     * `supported` として宣言する。取り消すと宣言も戻る。
     */
    register<T>(key: MapServiceKey<T>, value: T): MapServiceRegistration {
        const erased = key as MapServiceKey<unknown>;
        this.services.set(erased, value);
        const capability = key.capability;
        const previousStatus = capability ? this.capabilities.get(capability) : undefined;
        if (capability) this.capabilities.set(capability, Status.supported);

        return {
            dispose: () => {
                // 自分が入れた値がまだ残っているときだけ外す（後から別の実装で
                // 上書きされていた場合にそれを消してしまわないように）。
                if (this.services.get(erased) === value) this.services.delete(erased);
                if (!capability) return;
                if (previousStatus === undefined) {
                    if (this.capabilities.get(capability) === Status.supported) {
                        this.capabilities.delete(capability);
                    }
                } else {
                    this.capabilities.set(capability, previousStatus);
                }
            },
        };
    }

    get<T>(key: MapServiceKey<T>): T | null {
        return (this.services.get(key as MapServiceKey<unknown>) as T) ?? null;
    }

    has<T>(key: MapServiceKey<T>): boolean {
        return this.services.has(key as MapServiceKey<unknown>);
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
        const capability = key.capability;
        if (capability && this.capabilities.get(capability) === Status.supported) {
            this.capabilities.delete(capability);
        }
    }

    clear(): void {
        this.services.clear();
        this.capabilities.clear();
    }

    /**
     * 対応状況を明示的に宣言する。
     *
     * 「まだ登録されていない」と「この SDK では原理的にできない」を区別するために使う。
     */
    declare(capability: MapCapability, status: MapCapabilityStatus): MapServiceRegistration {
        const previous = this.capabilities.get(capability);
        this.capabilities.set(capability, status);
        return {
            dispose: () => {
                if (previous === undefined) {
                    if (this.capabilities.get(capability) === status) this.capabilities.delete(capability);
                } else {
                    this.capabilities.set(capability, previous);
                }
            },
        };
    }

    /** {@link declare} の短縮形。 */
    declareUnsupported(capability: MapCapability, reason: string): MapServiceRegistration {
        return this.declare(capability, Status.unsupported(reason));
    }

    /** 宣言済みの capability を列挙する（診断・適合テスト用）。 */
    declaredCapabilities(): ReadonlyMap<MapCapability, MapCapabilityStatus> {
        return new Map(this.capabilities);
    }

    capabilityStatus(capability: MapCapability): MapCapabilityStatus {
        return this.capabilities.get(capability) ?? Status.unknown;
    }
}

export const EmptyMapServiceRegistry: MapServiceRegistry = {
    get: () => null,
    has: () => false,
    capabilityStatus: () => Status.unknown,
};
