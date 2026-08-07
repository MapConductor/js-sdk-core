import { createGeoPoint, type GeoPoint } from '../features';

/**
 * Turns an outer ring plus any number of hole rings into a single ring whose
 * holes are stitched in with bridges (equivalent to mapbox/earcut's
 * `eliminateHoles`). android-sdk-core `HoleBridge.kt` and ios-sdk-core
 * `HoleBridge.swift` are the same algorithm.
 *
 * Use it with renderers that cannot express inner rings natively (TomTom's
 * plain Polygon, for instance) to fill a polygon-with-holes as one plain
 * polygon. Every hole is joined to the outer ring (or to a ring already
 * bridged) by a zero-width bridge, leaving one weakly simple polygon. The fill
 * cuts the holes out correctly, but the bridges remain as thin slits, so draw
 * the outline separately with stroke-only polygons.
 *
 * Input winding does not matter (normalized internally to CCW outer / CW
 * holes). Coordinates are treated as x = longitude, y = latitude.
 *
 * @param separation Degrees by which to offset the "outbound" and "inbound"
 *   edges of a bridge sideways. At 0 the bridge has zero width (the two edges
 *   have identical coordinates), which Android's TomTom fills as-is, but the
 *   tessellators in iOS TomTom (Orbis) and HERE treat as a self-touching ring
 *   and either break the fill or ignore the holes. A positive value yields a
 *   strictly simple ring whose holes still cut out under either fill rule (the
 *   gap is invisible on screen).
 */
export function bridgeHolesIntoSingleRing(
    outer: GeoPoint[],
    holes: GeoPoint[][],
    separation = 0,
): GeoPoint[] {
    if (holes.length === 0) return outer;

    const outerNode = buildRing(dropClosing(outer), false);
    if (!outerNode) return outer;

    const queue: Node[] = [];
    for (const hole of holes) {
        const list = buildRing(dropClosing(hole), true);
        if (list) queue.push(leftmost(list));
    }
    // Holes are processed by ascending leftmost x (same as earcut).
    queue.sort((lhs, rhs) => (lhs.x !== rhs.x ? lhs.x - rhs.x : lhs.y - rhs.y));

    for (const holeLeftmost of queue) {
        const bridge = findHoleBridge(holeLeftmost, outerNode);
        if (bridge) splitPolygon(bridge, holeLeftmost, separation);
    }

    const result: GeoPoint[] = [];
    let p = outerNode;
    do {
        result.push(p.source);
        p = p.next;
    } while (p !== outerNode);
    return result;
}

/**
 * Wrap-aware bridging.
 *
 * The standard (earcut-style) bridge searches westwards from a hole's leftmost
 * vertex, so on a world-mask-sized outer ring a bridge edge can span more than
 * 180° of longitude. Native map renderers (TomTom Orbis, HERE, …) draw such an
 * edge the "short way" (across the antimeridian), which self-intersects the
 * ring and breaks the fill. When the westward result contains an edge over
 * 180°, this mirrors the longitudes, bridges eastwards instead, and returns
 * whichever result keeps the longitude steps smaller.
 */
export function bridgeHolesIntoSingleRingWrapAware(
    outer: GeoPoint[],
    holes: GeoPoint[][],
    separation = 0,
): GeoPoint[] {
    const west = bridgeHolesIntoSingleRing(outer, holes, separation);
    const westMax = maxAbsLngStep(west);
    if (westMax <= 180) return west;

    const east = bridgeHolesIntoSingleRing(
        outer.map(mirrorLng),
        holes.map(hole => hole.map(mirrorLng)),
        separation,
    ).map(mirrorLng);
    return maxAbsLngStep(east) < westMax ? east : west;
}

const mirrorLng = (point: GeoPoint): GeoPoint =>
    createGeoPoint({
        latitude: point.latitude,
        longitude: -point.longitude,
        altitude: point.altitude ?? 0,
    });

function maxAbsLngStep(ring: GeoPoint[]): number {
    if (ring.length < 2) return 0;
    let maxStep = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        maxStep = Math.max(maxStep, Math.abs(b.longitude - a.longitude));
    }
    return maxStep;
}

// ─── Implementation ─────────────────────────────────────────────────────────

class Node {
    prev: Node;
    next: Node;

    constructor(
        readonly x: number,
        readonly y: number,
        readonly source: GeoPoint,
    ) {
        this.prev = this;
        this.next = this;
    }
}

function dropClosing(points: GeoPoint[]): GeoPoint[] {
    if (
        points.length >= 2 &&
        points[0].latitude === points[points.length - 1].latitude &&
        points[0].longitude === points[points.length - 1].longitude
    ) {
        return points.slice(0, -1);
    }
    return points;
}

/** Builds a circular linked list from `points`, normalizing winding, and returns its head. */
function buildRing(points: GeoPoint[], wantClockwise: boolean): Node | null {
    if (points.length < 3) return null;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.longitude * b.latitude - b.longitude * a.latitude;
    }
    const isCcw = sum > 0;
    // wantClockwise === true wants CW, false wants CCW; reverse when it differs.
    const ordered = isCcw === wantClockwise ? [...points].reverse() : points;

    let last: Node | null = null;
    for (const pt of ordered) {
        const node = new Node(pt.longitude, pt.latitude, pt);
        if (last) {
            node.prev = last;
            node.next = last.next;
            last.next.prev = node;
            last.next = node;
        }
        last = node;
    }
    return last ? last.next : null;
}

function leftmost(start: Node): Node {
    let p = start;
    let min = start;
    do {
        if (p.x < min.x || (p.x === min.x && p.y < min.y)) min = p;
        p = p.next;
    } while (p !== start);
    return min;
}

/** Finds a reachable (visible) node on the outer ring to bridge a hole's leftmost node to. */
function findHoleBridge(hole: Node, outerNode: Node): Node | null {
    let p = outerNode;
    const hx = hole.x;
    const hy = hole.y;
    let qx = Number.NEGATIVE_INFINITY;
    let m: Node | null = null;

    // Cast a horizontal ray westwards from the hole's leftmost vertex and take
    // the nearest (largest x) outer edge it crosses.
    do {
        if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
            const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
            if (x <= hx && x > qx) {
                qx = x;
                if (x === hx) return p.x < p.next.x ? p : p.next;
                m = p.x < p.next.x ? p : p.next;
            }
        }
        p = p.next;
    } while (p !== outerNode);

    const bridge = m;
    if (!bridge) return null;

    // If a vertex lies inside the triangle formed by the candidate bridge, the
    // hole and the ray hit, re-target the bridge at the vertex with the smaller
    // angle (avoids self-intersection on concave outer rings and nearby holes).
    const stop = bridge;
    let best = bridge;
    const mx = bridge.x;
    const my = bridge.y;
    let tanMin = Number.POSITIVE_INFINITY;
    p = bridge;
    do {
        const inTri =
            hy < my
                ? pointInTriangle(hx, hy, mx, my, qx, hy, p.x, p.y)
                : pointInTriangle(qx, hy, mx, my, hx, hy, p.x, p.y);
        if (hx >= p.x && p.x >= mx && hx !== p.x && inTri) {
            const tan = Math.abs(hy - p.y) / (hx - p.x);
            if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && p.x > best.x))) {
                best = p;
                tanMin = tan;
            }
        }
        p = p.next;
    } while (p !== stop);

    return best;
}

/**
 * Bridges `a` to `b` and re-links the rings (earcut's `splitPolygon`).
 * With separation > 0 the duplicated nodes (the inbound edge) are offset along
 * the bridge normal so the two edges do not share coordinates (self-touching).
 */
function splitPolygon(a: Node, b: Node, separation: number): Node {
    let a2x = a.x;
    let a2y = a.y;
    let b2x = b.x;
    let b2y = b.y;
    if (separation > 0) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
            const nx = (-dy / len) * separation;
            const ny = (dx / len) * separation;
            a2x += nx;
            a2y += ny;
            b2x += nx;
            b2y += ny;
        }
    }
    const a2 = new Node(
        a2x,
        a2y,
        separation > 0 ? createGeoPoint({ latitude: a2y, longitude: a2x }) : a.source,
    );
    const b2 = new Node(
        b2x,
        b2y,
        separation > 0 ? createGeoPoint({ latitude: b2y, longitude: b2x }) : b.source,
    );
    const an = a.next;
    const bp = b.prev;

    a.next = b;
    b.prev = a;
    a2.next = an;
    an.prev = a2;
    b2.next = a2;
    a2.prev = b2;
    bp.next = b2;
    b2.prev = bp;
    return b2;
}

const area = (p: Node, q: Node, r: Node): number =>
    (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

function locallyInside(a: Node, b: Node): boolean {
    return area(a.prev, a, a.next) < 0
        ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
        : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

const pointInTriangle = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    px: number,
    py: number,
): boolean =>
    (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
