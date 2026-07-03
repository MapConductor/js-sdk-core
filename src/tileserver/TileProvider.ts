import { TileRequest } from "./TileRequest";

export interface TileProvider {
    renderTile(request: TileRequest): Uint8Array | null | Promise<Uint8Array | null>;
}
