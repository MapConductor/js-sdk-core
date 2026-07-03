import { createGeoPoint, type GeoPoint } from '../features';
import type { PolygonState } from './PolygonState';

// ---------------------------------------------------------------------------
// Greiner-Hormann polygon union (2D planar, lon/lat coordinates)
// Mirrors `PolygonUnion.kt` which uses JTS CascadedPolygonUnion.
// ---------------------------------------------------------------------------

interface Pt { x: number; y: number; }

interface Vtx {
    p: Pt;
    next: Vtx;
    prev: Vtx;
    alpha: number;       // 0 = original vertex, 0<a<1 = intersection point
    intersect: boolean;
    entry: boolean;      // true = entering other polygon (for union: exiting one = entry into union boundary)
    checked: boolean;
    neighbor: Vtx | null;
}

function makePt(p: GeoPoint): Pt { return { x: p.longitude, y: p.latitude }; }

// Circular doubly-linked list
function buildRing(ring: GeoPoint[]): Vtx {
    if (ring.length === 0) throw new Error('empty ring');
    const nodes: Vtx[] = ring.map(gp => ({
        p: makePt(gp),
        next: null as unknown as Vtx,
        prev: null as unknown as Vtx,
        alpha: 0, intersect: false, entry: false, checked: false, neighbor: null,
    }));
    for (let i = 0; i < nodes.length; i++) {
        nodes[i].next = nodes[(i + 1) % nodes.length];
        nodes[i].prev = nodes[(i - 1 + nodes.length) % nodes.length];
    }
    return nodes[0];
}

function insertIntersection({
    after,
    before,
    ip,
    alpha,
}: {
    after: Vtx;
    before: Vtx;
    ip: Pt;
    alpha: number;
}): Vtx {
    const v: Vtx = { p: ip, next: before, prev: after, alpha, intersect: true, entry: false, checked: false, neighbor: null };
    after.next = v;
    before.prev = v;
    return v;
}

function segIntersect({
    a1,
    a2,
    b1,
    b2,
}: {
    a1: Pt;
    a2: Pt;
    b1: Pt;
    b2: Pt;
}): { p: Pt; ta: number; tb: number } | null {
    const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
    const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
    const denom = dy1 * dx2 - dx1 * dy2;
    if (Math.abs(denom) < 1e-12) return null;
    const ta = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
    const tb = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;
    if (ta <= 0 || ta >= 1 || tb <= 0 || tb >= 1) return null;
    return { p: { x: a1.x + ta * dx1, y: a1.y + ta * dy1 }, ta, tb };
}

function winding(pt: Pt, ring: Vtx): number {
    let wn = 0;
    let cur: Vtx = ring;
    do {
        const a = cur.p, b = cur.next.p;
        if (a.y <= pt.y) {
            if (b.y > pt.y && cross({ a, b, p: pt }) > 0) wn++;
        } else {
            if (b.y <= pt.y && cross({ a, b, p: pt }) < 0) wn--;
        }
        cur = cur.next;
    } while (cur !== ring);
    return wn;
}

function cross({
    a,
    b,
    p,
}: {
    a: Pt;
    b: Pt;
    p: Pt;
}): number {
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function ringToPoints(head: Vtx): GeoPoint[] {
    const pts: GeoPoint[] = [];
    let v = head;
    do { pts.push(createGeoPoint({ latitude: v.p.y, longitude: v.p.x })); v = v.next; } while (v !== head);
    return pts;
}

function phaseInsertIntersections(P: Vtx, Q: Vtx): boolean {
    let anyFound = false;
    let pEdgeStart: Vtx = P;
    do {
        let pEdgeEnd = pEdgeStart;
        // Skip past previously inserted intersections on P's original edge
        while (pEdgeEnd.next !== P && pEdgeEnd.next.intersect && pEdgeEnd.next.alpha > pEdgeStart.alpha)
            pEdgeEnd = pEdgeEnd.next;
        pEdgeEnd = pEdgeStart.next;

        let qEdgeStart: Vtx = Q;
        do {
            let qEdgeEnd = qEdgeStart.next;
            const result = segIntersect({
                a1: pEdgeStart.p,
                a2: pEdgeEnd.p,
                b1: qEdgeStart.p,
                b2: qEdgeEnd.p,
            });
            if (result) {
                anyFound = true;
                const iPv = insertIntersection({ after: pEdgeStart, before: pEdgeEnd, ip: result.p, alpha: result.ta });
                const iQv = insertIntersection({ after: qEdgeStart, before: qEdgeEnd, ip: result.p, alpha: result.tb });
                iPv.neighbor = iQv;
                iQv.neighbor = iPv;
            }
            qEdgeStart = qEdgeStart.next;
        } while (qEdgeStart !== Q);

        pEdgeStart = pEdgeStart.next;
    } while (pEdgeStart !== P);
    return anyFound;
}

function phaseMarkEntryExit({
    P,
    Q,
    forUnion,
}: {
    P: Vtx;
    Q: Vtx;
    forUnion: boolean;
}): void {
    // For union: P starts outside Q (entry = P entering Q boundary in union = exiting Q)
    // We mark intersections as "entry" when the traversal point starts entering the UNION boundary
    const pInsideQ = winding(P.p, Q) !== 0;
    let pIn = forUnion ? pInsideQ : !pInsideQ;
    let v = P;
    do {
        if (v.intersect) {
            v.entry = !pIn;
            pIn = !pIn;
        }
        v = v.next;
    } while (v !== P);

    const qInsideP = winding(Q.p, P) !== 0;
    let qIn = forUnion ? qInsideP : !qInsideP;
    v = Q;
    do {
        if (v.intersect) {
            v.entry = !qIn;
            qIn = !qIn;
        }
        v = v.next;
    } while (v !== Q);
}

function phaseCollectUnion(P: Vtx): GeoPoint[][] {
    const polys: GeoPoint[][] = [];
    // Find first unvisited entry intersection on P
    let v = P;
    do {
        if (v.intersect && !v.checked && !v.entry) {
            // For union, start from "exit" intersections on P (where P goes OUTSIDE Q)
            const poly: GeoPoint[] = [];
            let cur: Vtx = v;
            const start = v;
            do {
                cur.checked = true;
                if (cur.neighbor) cur.neighbor.checked = true;
                if (!cur.intersect || !cur.entry) {
                    // Moving along polygon boundary
                    poly.push(createGeoPoint({ latitude: cur.p.y, longitude: cur.p.x }));
                    cur = cur.next;
                } else {
                    // At an "entry" intersection: switch to the other polygon (traversing backward)
                    cur = cur.neighbor!;
                    cur.checked = true;
                    cur = cur.prev; // union: switch direction
                }
            } while (cur !== start && poly.length < 10000);
            if (poly.length >= 3) polys.push(poly);
        }
        v = v.next;
    } while (v !== P);
    return polys;
}

/**
 * Attempts to union two simple polygons using the Greiner-Hormann algorithm (planar lon/lat).
 * Returns null if the polygons don't intersect or union fails.
 */
function unionTwo(a: GeoPoint[], b: GeoPoint[]): GeoPoint[] | null {
    try {
        const P = buildRing(a);
        const Q = buildRing(b);
        const hasIntersections = phaseInsertIntersections(P, Q);
        if (!hasIntersections) {
            // No edge intersections: check containment
            if (winding(P.p, Q) !== 0) return ringToPoints(Q); // a ⊂ b
            if (winding(Q.p, P) !== 0) return ringToPoints(P); // b ⊂ a
            return null; // disjoint
        }
        phaseMarkEntryExit({ P, Q, forUnion: true });
        const polys = phaseCollectUnion(P);
        if (polys.length === 1) return polys[0];
        if (polys.length === 0) return null;
        // Multiple output polygons: return the largest by bounding area
        return polys.reduce((best, p) => bbox(p) >= bbox(best) ? p : best);
    } catch {
        return null;
    }
}

function bbox(ring: GeoPoint[]): number {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of ring) {
        if (p.longitude < minX) minX = p.longitude;
        if (p.longitude > maxX) maxX = p.longitude;
        if (p.latitude < minY) minY = p.latitude;
        if (p.latitude > maxY) maxY = p.latitude;
    }
    return (maxX - minX) * (maxY - minY);
}

function signedArea(ring: GeoPoint[]): number {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        area += a.longitude * b.latitude - b.longitude * a.latitude;
    }
    return area / 2;
}

/**
 * Unions overlapping hole rings.
 * Mirrors `PolygonState.unionHoles()` from `PolygonUnion.kt`.
 */
export function unionHoles(state: PolygonState): PolygonState {
    if (state.holes.length <= 1) return state;

    let current: GeoPoint[][] = state.holes.map(h => [...h]);
    let changed = false;

    let i = 0;
    while (i < current.length) {
        let merged = false;
        for (let j = i + 1; j < current.length; j++) {
            const result = unionTwo(current[i], current[j]);
            if (result) {
                current.splice(j, 1);
                current[i] = result;
                changed = true;
                merged = true;
                break;
            }
        }
        if (!merged) i++;
    }

    if (!changed) return state;

    // Normalize hole winding: make holes clockwise (negative area in lon/lat)
    const normalizedHoles: GeoPoint[][] = current.map(ring => {
        const area = signedArea(ring);
        return area > 0 ? [...ring].reverse() : ring;
    }).filter(r => r.length >= 3);

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
