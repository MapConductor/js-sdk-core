import { HexCell } from ".";

export interface HexCellWithDistance {
    cell: HexCell;
    distanceMeters: number;
}

export function createHexCellWithDistance(params: { 
    cell: HexCell;
    distanceMeters: number;
}): HexCellWithDistance {
    return {
        cell: params.cell,
        distanceMeters: params.distanceMeters,
    };
}
