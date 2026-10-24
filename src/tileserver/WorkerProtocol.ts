import type { TileRequest } from './TileRequest';
import type { TileOutcome } from './TileOutcome';

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
    /**
     * Why there are no bytes. Optional because a worker built against an
     * older version of this package does not send it; a missing outcome with
     * no bytes is read as `empty`, which is what null meant before.
     */
    readonly outcome?: TileOutcome['kind'];
}
