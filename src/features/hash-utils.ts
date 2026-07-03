import type { GeoPoint } from "./GeoPoint";

export const toInt = (n: number) => (n | 0); // 32bit化
export const hashStr = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = toInt((h * 31 + s.charCodeAt(i)) | 0);
    return h;
};
export const hashNum = (n: number) => toInt(Math.trunc(n * 1e7));
export const hashBool = (b: boolean) => (b ? 1231 : 1237);
export const hashNullable = (n: number | null | undefined) => (n ?? 0);
export const hashObj = (o: unknown) => hashStr(JSON.stringify(o));
export const combineHash = (result: number, hash: number) => toInt(31 * result + hash);
export const hashGeoPoint = (p: GeoPoint) => {
    let result = hashNum(p.latitude);
    result = combineHash(result, hashNum(p.longitude));
    result = combineHash(result, hashNum(p.altitude ?? 0));
    return result;
};

export const generateIdFromHashes = (hashes: number[]) =>
    hashes.reduce((acc, h, index) => (index === 0 ? toInt(h) : combineHash(acc, h)), 0);
