import { type GeoPoint } from "../features";
import { splitByMeridian } from "../sperical/SplitByMeridian";

/**
 * 閉じたリング（開いた頂点列として渡す）を ±180 子午線で分割する。
 *
 * `splitByMeridian` は開いたパス用で、末尾→先頭のラップセグメントを見ないため、
 * 子午線を偶数回跨ぐリングでは「最初の断片」と「最後の断片」が本来ひとつながりの
 * ピースなのに別々に閉じられ、隙間（くさび）が生じる。ここでは最初の交差の直後から
 * 始まるようにリングを回転させ、ラップセグメントも含めて分割したうえで、先頭と末尾の
 * 断片を結合して正しいピース分割を返す。
 *
 * 交差が無ければ入力リングをそのまま 1 断片として返す。
 * android-sdk / ios-sdk の `splitRingByMeridian` と同一仕様。
 */
export function splitRingByMeridian(
    ring: GeoPoint[],
    geodesic: boolean,
): GeoPoint[][] {
    if (ring.length < 3) return ring.length === 0 ? [] : [ring];

    const crossesAt = (i: number): boolean => {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        return Math.abs(b.longitude - a.longitude) > 180.0;
    };

    let firstCrossing = -1;
    for (let i = 0; i < ring.length; i++) {
        if (crossesAt(i)) {
            firstCrossing = i;
            break;
        }
    }
    if (firstCrossing < 0) return [ring];

    // 最初の交差セグメント p[k] -> p[k+1] の直後（p[k+1]）から始まるよう回転し、
    // 末尾に先頭点を足してラップセグメント（p[k] -> p[k+1]）も処理対象にする。
    const rotated = [
        ...ring.slice(firstCrossing + 1),
        ...ring.slice(0, firstCrossing + 1),
    ];
    const fragments = splitByMeridian([...rotated, rotated[0]], geodesic);
    if (fragments.length < 2) return fragments;

    // 末尾断片はラップ交差で始まった「先頭断片の続き」（同じ点から始まる）なので結合する。
    const merged = [
        ...fragments[fragments.length - 1],
        ...fragments[0].slice(1),
    ];
    return [merged, ...fragments.slice(1, fragments.length - 1)];
}
