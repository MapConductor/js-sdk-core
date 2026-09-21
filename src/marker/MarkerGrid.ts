// The cell arithmetic behind {@link GeoGridIndex}, with no marker in sight.
//
// ## The scheme
//
// The world starts as **two square cells** — the western and eastern halves,
// 180 degrees on a side — and each is halved in latitude and in longitude,
// repeatedly. The key records the half chosen each time, latitude bit above
// longitude bit, under the bit that says which hemisphere it started in. That
// makes **every prefix of a key a cell:** dropping the low `2n` bits names the
// cell `n` levels up. A query picks the level that suits its box instead of
// paying the finest one, which is what the earlier single cell size of 0.005
// degrees could not do.
//
// ## Why two root cells and not one
//
// One root cell covering the whole globe is what cordova-plugin-googlemaps'
// `geomodel.js` uses, and it is what this started as. It makes every cell
// **twice as wide as it is tall**, because the same number of divisions covers
// 360 degrees of longitude and 180 of latitude.
//
// That costs real time. A query asks for cells no wider than some separation;
// with a 2:1 cell, satisfying the width over-resolves the height by a factor of
// two, so the query walks twice the cells and returns twice the markers it
// asked for. Measured on ios-sdk with Tokyo's 144,183 street trees at zoom 11,
// a tile returned 9,715 markers of which the caller kept 2,156, and the work
// that scales with that count — the walk, positioning each marker, and grouping
// them — was 44 ms of the tile's 52 ms.
//
// Splitting the root into two square halves removes the factor of two. The
// string form keeps its shape: a hemisphere digit followed by geocell
// characters over `0123456789abcdef`, one per 4x4 subdivision, and a prefix is
// still a cell. What it is no longer is byte-identical to `geomodel.js`.
//
// ## Why none of this uses `<<` or `>>`
//
// A key is 37 bits. JavaScript's bitwise operators coerce their operands to
// **int32** first, so `2 ** 40 | 0` is 0 — a shift here would not overflow
// loudly, it would silently return the wrong cell. `number` itself is fine:
// doubles hold integers exactly to 2^53. So every shift below is written as a
// multiplication or a `Math.floor` division, which is exact at this size.
//
// Measured over Tokyo's 144,183 street trees: building the keys this way takes
// 12 ms, against 90 ms with `BigInt`.

/**
 * Levels of 2x2 subdivision below the two root cells.
 *
 * 18 matches the other two SDKs, where it is the largest depth that still
 * leaves 24 bits of marker position under the key inside a 63-bit integer. It
 * is also an even number of levels, so the string form packs into whole 4-bit
 * characters.
 *
 * A cell at the bottom is 0.000687 degrees on a side, about 76 m at the
 * equator.
 *
 * @internal
 */
export const GRID_DEPTH = 18;

/**
 * Roughly how many cells across a box a query aims to walk.
 *
 * The level is chosen so the box covers about this many cells squared, which
 * bounds the walk no matter how large the box is.
 */
const CELLS_ACROSS = 32;

/**
 * The most cells a query walks along either axis.
 *
 * Only bites on a box so flat or so narrow that its area says nothing about how
 * many cells it crosses.
 */
const MAX_CELLS_PER_AXIS = 64;

const ALPHABET = '0123456789abcdef';

/**
 * Degrees a cell spans, on either axis. Cells are square.
 *
 * @internal
 */
export function cellSize(level: number): number {
    return 180 / 2 ** level;
}

/**
 * Rows of cells from pole to pole at `level`.
 *
 * @internal
 */
export function rows(level: number): number {
    return 2 ** level;
}

/**
 * Columns of cells around the globe at `level`. Twice the rows, because the
 * world is twice as wide as it is tall and the cells are square.
 *
 * @internal
 */
export function columns(level: number): number {
    return 2 ** (level + 1);
}

/**
 * The coarsest level whose cells are no wider than `separation`, or null if
 * even the bottom level is coarser than that.
 *
 * Counted up rather than solved with a logarithm, because the three SDKs have
 * to agree and they do not have the same `log2` — Java has none, so Kotlin
 * computes `ln(x) / ln(2)`, which is off by an ulp where the true answer is a
 * whole number. Halving a double and comparing it is exact everywhere.
 *
 * @internal
 */
export function levelForSeparation(separation: number): number | null {
    if (!(separation > 0)) return null;
    for (let level = 0; level <= GRID_DEPTH; level++) {
        if (cellSize(level) <= separation) return level;
    }
    return null;
}

/**
 * The level a bounds query walks, chosen so the box covers about
 * `CELLS_ACROSS` squared cells.
 *
 * @internal
 */
export function queryLevel(latSpan: number, lonSpan: number): number {
    const area = Math.max(lonSpan, 1e-12) * Math.max(latSpan, 1e-12);
    // cells at a level = area / cellSize^2, and cellSize = 180 / 2^level
    const budget = CELLS_ACROSS * CELLS_ACROSS * 180 * 180;
    let level = 0;
    while (level < GRID_DEPTH && area * 4 ** (level + 1) <= budget) level++;
    // The area rule alone is not enough. A box with no height — a click box
    // flattened by a degenerate projection, a bounds built from two points on
    // the same parallel — has an area of nothing, which asks for the bottom
    // level, which is a quarter of a million columns to walk. Step back up
    // until neither axis is absurd. On a box of ordinary shape the area rule
    // binds first and this does nothing.
    while (
        level > 0 &&
        (lonSpan / cellSize(level) > MAX_CELLS_PER_AXIS ||
            latSpan / cellSize(level) > MAX_CELLS_PER_AXIS)
    ) {
        level--;
    }
    return level;
}

/**
 * How far east the box runs, from its west edge to its east one.
 *
 * A box crossing the antimeridian has its east corner west of its west one, and
 * a padded box can run past ±180 outright. Normalising to a single eastward
 * span removes both cases: everything downstream walks east from the west edge
 * for this many degrees, and never compares two longitudes.
 *
 * @internal
 */
export function eastwardSpan(west: number, east: number): number {
    if (east - west >= 360) return 360;
    return (((east - west) % 360) + 360) % 360;
}

/**
 * The columns a box covers: where to start, and how many to walk.
 *
 * The end column is taken from `west + span`, not from the east corner. Taking
 * it from the corner cannot work once column indices fold: the column holding
 * 180 and the column holding -180 are the same one, so a box from -180.2 to
 * 179.8 starts and ends on the same column and the walk covers one column out
 * of the level's many. Nothing errors; the query simply answers for a thin
 * slice of the world.
 *
 * @internal
 */
export function columnWalk(
    west: number,
    span: number,
    level: number,
): { start: number; count: number } {
    const total = columns(level);
    const start = Math.floor(((west + 180) / 360) * total);
    const end = Math.floor(((west + span + 180) / 360) * total);
    // A full turn ends on the column it started on; walking both would return
    // that column's items twice.
    return { start, count: Math.min(end - start + 1, total) };
}

/**
 * The row a latitude falls in, clamped at the poles.
 *
 * @internal
 */
export function latCell(latitude: number, level: number): number {
    const count = rows(level);
    const at = Math.floor(((latitude + 90) / 180) * count);
    return Math.min(Math.max(at, 0), count - 1);
}

/**
 * The column a longitude falls in, folded back onto the globe.
 *
 * @internal
 */
export function lonCell(longitude: number, level: number): number {
    const count = columns(level);
    return wrap(Math.floor(((longitude + 180) / 360) * count), level);
}

/**
 * Folds a column index back onto the globe, so 180 and -180 share cells.
 *
 * @internal
 */
export function wrap(lonCell: number, level: number): number {
    const count = columns(level);
    return ((lonCell % count) + count) % count;
}

/**
 * Interleaves the two indices, latitude in the odd bits, under the bit that
 * says which root cell they are in.
 *
 * Longitude carries one bit more than latitude — twice as many columns as rows
 * — and that top bit is the hemisphere. It sits above the interleaved pairs
 * rather than inside them, so dropping the low two bits still names the parent
 * cell.
 *
 * @internal
 */
export function morton(latCell: number, lonCell: number, level: number): number {
    const hemisphere = Math.floor(lonCell / 2 ** level);
    const within = lonCell % 2 ** level;
    return hemisphere * 4 ** level + spread(latCell) * 2 + spread(within);
}

/**
 * Spreads a value's bits apart, leaving a zero between each pair.
 *
 * The usual implementation is five masked shifts. Those are int32 operations,
 * and the result here is up to 36 bits wide, so this walks the bits instead. It
 * runs once per marker at build time and per cell at query time — not on any
 * inner loop — and 18 iterations of exact arithmetic beat being subtly wrong.
 */
function spread(value: number): number {
    let out = 0;
    let scale = 1;
    let rest = value;
    for (let bit = 0; bit < GRID_DEPTH; bit++) {
        if (rest % 2 === 1) out += scale;
        rest = Math.floor(rest / 2);
        scale *= 4;
    }
    return out;
}

/**
 * The key an item's position lands on, at the bottom level.
 *
 * @internal
 */
export function mortonKeyFor(latitude: number, longitude: number): number {
    return morton(latCell(latitude, GRID_DEPTH), lonCell(longitude, GRID_DEPTH), GRID_DEPTH);
}

/**
 * The cell's name as a string: a hemisphere digit, then one character per 4x4
 * subdivision over `0123456789abcdef`.
 *
 * Each character after the first is two levels of this grid, so a string of
 * `characters` names the cell at level `2 * (characters - 1)`. Not used by the
 * index itself — the key is the same information, and faster — but it is the
 * form the three SDKs' conformance fixtures compare, because it does not depend
 * on how a platform stores an integer.
 *
 * @internal
 */
export function geocell(latitude: number, longitude: number, characters: number): string {
    const level = Math.min(Math.max(characters - 1, 0) * 2, GRID_DEPTH);
    const key = morton(latCell(latitude, level), lonCell(longitude, level), level);
    let text = String(Math.floor(key / 4 ** level));
    for (let at = level * 2 - 4; at >= 0; at -= 4) {
        text += ALPHABET[Math.floor(key / 2 ** at) % 16];
    }
    return text;
}
