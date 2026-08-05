import type { GeoPoint } from "./GeoPoint";

export const toInt = (n: number) => (n | 0); // 32bit化
export const hashStr = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = toInt((h * 31 + s.charCodeAt(i)) | 0);
    return h;
};
/**
 * Java `Long.hashCode()` 相当: `(int)(v ^ (v >>> 32))`。
 * v は truncate（0 方向切り捨て）した 64bit 整数。座標(lat/lng/alt)×1e7 のように
 * 負値・大きな値を扱うハッシュを android-sdk / ios-sdk と一致させるために使う。
 */
export const longHashCode = (value: number): number => {
    const v = BigInt.asUintN(64, BigInt(Math.trunc(value)));
    return Number(BigInt.asIntN(32, v ^ (v >> 32n)));
};
export const hashNum = (n: number) => toInt(Math.trunc(n * 1e7));
export const hashBool = (b: boolean) => (b ? 1231 : 1237);
export const hashNullable = (n: number | null | undefined) => (n ?? 0);
export const hashObj = (o: unknown) => hashStr(JSON.stringify(o));
export const combineHash = (result: number, hash: number) => toInt(31 * result + hash);
export const hashGeoPoint = (p: GeoPoint) => {
    let result = longHashCode(p.latitude * 1e7);
    result = combineHash(result, longHashCode(p.longitude * 1e7));
    result = combineHash(result, longHashCode((p.altitude ?? 0) * 1e7));
    return result;
};

export const generateIdFromHashes = (hashes: number[]) =>
    hashes.reduce((acc, h, index) => (index === 0 ? toInt(h) : combineHash(acc, h)), 0);
