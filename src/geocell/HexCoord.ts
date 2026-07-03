import { Direction6Delta } from "./Direction6";

export interface HexCoord {
    q: number;
    r: number;
    depth: number;
    readonly s: number;
    neighbors(): HexCoord[];
}


export function createHexCoord({
    q,
    r,
    depth = 0,
}: {
    q: number;
    r: number;
    depth?: number;
}) {
    return {
        q,
        r,
        depth,
        get s() {
            return -this.q - this.r;
        },
        neighbors() {
            return getNeighbors(this);
        },
    };
}

export function hexCoordToString(hexCoord: HexCoord): string {
    return `H${hexCoord.q}_${hexCoord.r}_${hexCoord.depth}`;
}

// Get neighboring coordinates
export function getNeighbors(hexCoord: HexCoord): HexCoord[] {
    return Object.values(Direction6Delta).map(it => 
        createHexCoord({
            q: hexCoord.q + it.deltaQ,
            r: hexCoord.r + it.deltaR,
            depth: hexCoord.depth,
        }),
    );
}
