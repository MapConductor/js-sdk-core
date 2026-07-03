import type { TileRequest } from './TileRequest';

export interface TileRenderRequest {
    readonly type: 'render';
    readonly id: number;
    readonly routeId: string;
    readonly request: TileRequest;
}

export interface TileRenderResponse {
    readonly type: 'render';
    readonly id: number;
    readonly result: Uint8Array | null;
}
