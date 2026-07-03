import { HexCell } from "./HexCell";

export interface IdentifiedHexCell {
    id: string;
    cell: HexCell;
}

export function createIdentifiedHexCell(
    id: string,
    cell: HexCell,
): IdentifiedHexCell {
    return {
        id,
        cell,
    };
}