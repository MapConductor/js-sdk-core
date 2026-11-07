/**
 * Google's Encoded Polyline Algorithm Format, with the precision as a parameter.
 *
 * Each coordinate is rounded to `10^-precision` degrees, stored as the
 * difference from the previous one, and written as base-64 variable-length
 * groups. 5 is Google's own precision (about 1 m); 6 (about 0.1 m, "polyline6")
 * is what the polygon tiles use, so a building's corners survive the trip.
 *
 * Coordinates go in and come out as a flat `[lat, lng, lat, lng, ...]`, the
 * order the format itself uses.
 */
export function encodePolyline(latLngs: ArrayLike<number>, precision = 5): string {
    const factor = 10 ** precision;
    let out = '';
    let prevLat = 0;
    let prevLng = 0;
    for (let i = 0; i + 1 < latLngs.length; i += 2) {
        const lat = Math.round(latLngs[i] * factor);
        const lng = Math.round(latLngs[i + 1] * factor);
        out += encodeSigned(lat - prevLat) + encodeSigned(lng - prevLng);
        prevLat = lat;
        prevLng = lng;
    }
    return out;
}

export function decodePolyline(encoded: string, precision = 5): number[] {
    const factor = 10 ** precision;
    const out: number[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
        const dLat = readSigned();
        const dLng = readSigned();
        lat += dLat;
        lng += dLng;
        out.push(lat / factor, lng / factor);
    }
    return out;

    function readSigned(): number {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            // Multiplication, not `<<`: a 32-bit shift overflows past 6 groups.
            result += (byte & 0x1f) * 2 ** shift;
            shift += 5;
        } while (byte >= 0x20);
        return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
    }
}

function encodeSigned(value: number): string {
    // Zigzag: 0, -1, 1, -2, ... -> 0, 1, 2, 3, ... Arithmetic rather than
    // bit operations so values past 2^31 (precision 6 near ±180°) stay exact.
    let v = value < 0 ? -value * 2 - 1 : value * 2;
    let out = '';
    while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v % 0x20)) + 63);
        v = Math.floor(v / 0x20);
    }
    return out + String.fromCharCode(v + 63);
}
