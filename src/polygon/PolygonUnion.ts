import { createGeoPoint, type GeoPoint } from '../features';
import type { PolygonState } from './PolygonState';

/**
 * Unions overlapping hole rings in a planar lon/lat coordinate space, with no
 * external geometry library.
 *
 * Mirrors Android's `PolygonState.unionHoles()` (which uses JTS
 * `CascadedPolygonUnion`). Instead of a Boolean-op sweep line, this builds the
 * planar arrangement of all hole edges (splitting them at every intersection),
 * keeps only the sub-edges that lie on the outer boundary of the union — those
 * with the union interior on exactly one side, decided by point-in-polygon
 * coverage — and chains them back into rings.
 *
 * Notes:
 * - Planar geometry (not geodesic). For very large polygons or near the poles,
 *   results may differ from spherical expectations.
 * - Any failure falls back to returning the rings unchanged.
 */
export function unionHoleRings(holes: GeoPoint[][]): GeoPoint[][] {
    if (holes.length <= 1) return holes;

    try {
        // Work relative to an origin so coordinates stay feature-scale, which
        // keeps cross-product precision high far from lon/lat 0 (e.g. Tokyo).
        const origin = firstFinite(holes);
        if (!origin) return holes;

        const rings = holes
            .map(hole => toRing(hole, origin))
            .filter((ring): ring is Vec[] => ring != null);
        if (rings.length <= 1) return holes;

        const merged = unionRings(rings);
        if (merged.length === 0) return holes;

        return merged.map(ring => {
            const geo = ring.map(p =>
                createGeoPoint({ latitude: p.y + origin.y, longitude: p.x + origin.x }),
            );
            // Normalize hole winding to clockwise (renderers expect holes to wind
            // opposite the shell). unionRings emits counter-clockwise rings.
            return signedArea(ring) > 0 ? geo.reverse() : geo;
        });
    } catch {
        return holes;
    }
}

/** Unions overlapping hole rings and returns a copied PolygonState when changed. */
export function unionHoles(state: PolygonState): PolygonState {
    const normalizedHoles = unionHoleRings(state.holes);
    if (normalizedHoles === state.holes) return state;
    return state.copy({ holes: normalizedHoles });
}

/** Alias: in-place mutation variant. */
export function unionHolesInPlace(state: PolygonState): PolygonState {
    const merged = unionHoles(state);
    if (merged !== state) {
        state.holes = merged.holes;
    }
    return state;
}

// ─── Planar union implementation ────────────────────────────────────────────

interface Vec {
    x: number;
    y: number;
}

interface Edge {
    a: Vec;
    b: Vec;
}

// Snap grid (degrees): shared endpoints must match exactly for chaining. ~0.1mm.
const Q = 1e-9;
// Tolerance for parallel/collinear/on-segment tests in feature-scale coords.
const EPS = 1e-12;

function unionRings(rings: Vec[][]): Vec[][] {
    // Directed edges of every ring (closed).
    const edges: Edge[] = [];
    for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            if (!samePoint(a, b)) edges.push({ a, b });
        }
    }

    const subEdges = splitEdges(edges);
    const boundary = classifyBoundary(subEdges, rings);
    return traceRings(boundary);
}

/** Split every edge at all points where another edge crosses or touches it. */
function splitEdges(edges: Edge[]): Edge[] {
    const result: Edge[] = [];
    for (let i = 0; i < edges.length; i++) {
        const seg = edges[i];
        const dir = sub(seg.b, seg.a);
        const lenSq = dot(dir, dir);
        if (lenSq < EPS) continue;

        // Collect cut points as parameters t in [0, 1] along the segment.
        const params = new Map<string, number>();
        const add = (p: Vec): void => {
            const t = clamp01(dot(sub(p, seg.a), dir) / lenSq);
            params.set(keyOf(snap(add2(seg.a, scale(dir, t)))), t);
        };
        add(seg.a);
        add(seg.b);
        for (let j = 0; j < edges.length; j++) {
            if (i === j) continue;
            for (const p of intersectionPoints(seg, edges[j])) add(p);
        }

        const points = [...params.entries()]
            .sort((l, r) => l[1] - r[1])
            .map(([, t]) => snap(add2(seg.a, scale(dir, t))));
        for (let k = 0; k + 1 < points.length; k++) {
            if (!samePoint(points[k], points[k + 1])) {
                result.push({ a: points[k], b: points[k + 1] });
            }
        }
    }
    return result;
}

/**
 * Keep the sub-edges on the union boundary, oriented so the union interior is on
 * their left (yielding counter-clockwise rings), de-duplicated.
 */
function classifyBoundary(subEdges: Edge[], rings: Vec[][]): Edge[] {
    const out: Edge[] = [];
    const seen = new Set<string>();
    for (const seg of subEdges) {
        const dir = sub(seg.b, seg.a);
        const len = Math.hypot(dir.x, dir.y);
        if (len < EPS) continue;

        const mid = add2(seg.a, scale(dir, 0.5));
        // Unit left normal. Sample coverage just off each side of the mid-point;
        // after splitting, no other edge crosses this sub-edge's interior, so a
        // small offset stays within the two cells this edge separates.
        const nx = -dir.y / len;
        const ny = dir.x / len;
        const off = Math.min(len * 0.25, 1e-5);
        const leftInside = coverage({ x: mid.x + nx * off, y: mid.y + ny * off }, rings) > 0;
        const rightInside = coverage({ x: mid.x - nx * off, y: mid.y - ny * off }, rings) > 0;
        if (leftInside === rightInside) continue; // interior on both/neither side

        // Orient so the interior is on the left.
        const a = leftInside ? seg.a : seg.b;
        const b = leftInside ? seg.b : seg.a;
        const key = `${keyOf(a)}>${keyOf(b)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a, b });
    }
    return out;
}

/** Chain directed boundary edges into closed rings. */
function traceRings(edges: Edge[]): Vec[][] {
    const byStart = new Map<string, number[]>();
    edges.forEach((edge, index) => {
        const key = keyOf(edge.a);
        const list = byStart.get(key);
        if (list) list.push(index);
        else byStart.set(key, [index]);
    });

    const used = new Array<boolean>(edges.length).fill(false);
    const rings: Vec[][] = [];

    for (let i = 0; i < edges.length; i++) {
        if (used[i]) continue;
        const ring: Vec[] = [];
        let current = i;
        while (current !== -1 && !used[current] && ring.length <= edges.length) {
            used[current] = true;
            ring.push(edges[current].a);
            current = nextEdge(edges, byStart, used, edges[current]);
        }
        if (ring.length >= 3) rings.push(ring);
    }
    return rings;
}

/**
 * The next unused edge continuing from `edge.b`. At a shared vertex (more than
 * one continuation), pick the sharpest clockwise turn from the reverse of the
 * incoming direction — the standard "next edge around the vertex" that keeps the
 * interior on the left and never crosses another boundary curve.
 */
function nextEdge(edges: Edge[], byStart: Map<string, number[]>, used: boolean[], edge: Edge): number {
    const candidates = (byStart.get(keyOf(edge.b)) ?? []).filter(index => !used[index]);
    if (candidates.length === 0) return -1;
    if (candidates.length === 1) return candidates[0];

    const back = Math.atan2(edge.a.y - edge.b.y, edge.a.x - edge.b.x);
    let best = -1;
    let bestAngle = Infinity;
    for (const index of candidates) {
        const out = edges[index];
        let angle = back - Math.atan2(out.b.y - out.a.y, out.b.x - out.a.x);
        angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (angle < 1e-9) angle += 2 * Math.PI; // deprioritize a U-turn back the way we came
        if (angle < bestAngle) {
            bestAngle = angle;
            best = index;
        }
    }
    return best;
}

/** Points where segment `other` meets segment `seg` (crossings, T-junctions, collinear overlap ends). */
function intersectionPoints(seg: Edge, other: Edge): Vec[] {
    const r = sub(seg.b, seg.a);
    const s = sub(other.b, other.a);
    const qp = sub(other.a, seg.a);
    const rxs = cross(r, s);
    const qpxr = cross(qp, r);

    if (Math.abs(rxs) < EPS && Math.abs(qpxr) < EPS) {
        // Collinear: report the overlap endpoints that fall on `seg`.
        const rr = dot(r, r);
        if (rr < EPS) return [];
        let t0 = dot(sub(other.a, seg.a), r) / rr;
        let t1 = dot(sub(other.b, seg.a), r) / rr;
        if (t0 > t1) [t0, t1] = [t1, t0];
        const lo = Math.max(0, t0);
        const hi = Math.min(1, t1);
        if (lo > hi + EPS) return [];
        const points = [add2(seg.a, scale(r, lo))];
        if (hi > lo + EPS) points.push(add2(seg.a, scale(r, hi)));
        return points;
    }
    if (Math.abs(rxs) < EPS) return []; // parallel, disjoint

    const t = cross(qp, s) / rxs;
    const u = cross(qp, r) / rxs;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return [];
    return [add2(seg.a, scale(r, clamp01(t)))];
}

/** How many rings' interiors contain the point. */
function coverage(point: Vec, rings: Vec[][]): number {
    let count = 0;
    for (const ring of rings) {
        if (pointInRing(point, ring)) count++;
    }
    return count;
}

/** Even-odd ray-casting point-in-polygon (winding-independent). */
function pointInRing(point: Vec, ring: Vec[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if ((a.y > point.y) !== (b.y > point.y)) {
            const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
            if (point.x < x) inside = !inside;
        }
    }
    return inside;
}

// ─── Ring / vector helpers ──────────────────────────────────────────────────

function firstFinite(holes: GeoPoint[][]): Vec | null {
    for (const hole of holes) {
        for (const p of hole) {
            if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
                return { x: p.longitude, y: p.latitude };
            }
        }
    }
    return null;
}

/** Open, de-duplicated, origin-relative ring, or null when degenerate. */
function toRing(hole: GeoPoint[], origin: Vec): Vec[] | null {
    const points: Vec[] = [];
    for (const p of hole) {
        if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
        const point = snap({ x: p.longitude - origin.x, y: p.latitude - origin.y });
        if (points.length === 0 || !samePoint(points[points.length - 1], point)) {
            points.push(point);
        }
    }
    while (points.length >= 2 && samePoint(points[0], points[points.length - 1])) {
        points.pop();
    }
    return points.length >= 3 ? points : null;
}

function signedArea(ring: Vec[]): number {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add2 = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const snap = (p: Vec): Vec => ({ x: Math.round(p.x / Q) * Q, y: Math.round(p.y / Q) * Q });
const keyOf = (p: Vec): string => `${Math.round(p.x / Q)},${Math.round(p.y / Q)}`;
const samePoint = (a: Vec, b: Vec): boolean => keyOf(a) === keyOf(b);
