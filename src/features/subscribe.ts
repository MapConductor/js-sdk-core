
/* ========= ミニ Observable (distinctUntilChanged 内蔵) ========= */
type Unsubscribe = () => void;
type Subscriber<T> = (v: T) => void;

export const createSubject = <T>(isEqual: (a: T, b: T) => boolean) => {
    const subs = new Set<Subscriber<T>>();
    let last: T | undefined;
    return {
        next: (v: T) => {
            if (last !== undefined && isEqual(last, v)) return;
            last = v;
            subs.forEach((s) => s(v));
        },
        subscribe: (fn: Subscriber<T>): Unsubscribe => {
            subs.add(fn);
            if (last !== undefined) {
                fn(last);
            }
            return () => subs.delete(fn);
        },
    };
};
