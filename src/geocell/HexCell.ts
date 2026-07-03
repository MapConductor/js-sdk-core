import { GeoPoint } from "../features";
import { Offset } from "../types";
import { HexCoord } from "./HexCoord"

export interface HexCell {
    coord: HexCoord;
    centerLatLng: GeoPoint;
    centerXY: Offset;
    id: string;
    idPrefix(levels: number): string;
}

export function createHexCell({
    coord,
    centerLatLng,
    centerXY,
    id,
}: {
    coord: HexCoord;
    centerLatLng: GeoPoint;
    centerXY: Offset;
    id: string;
}): HexCell {
    return {
        coord,
        centerLatLng,
        centerXY,
        id,
        idPrefix(levels: number) {
            return id.split("_").slice(0, levels + 1).join("_");
        },
    };
}

export function hexCellToIdPrefix(params: {
    hexCell: HexCell;
    levels: number;
}): string {
    return params.hexCell.idPrefix(params.levels);
}
