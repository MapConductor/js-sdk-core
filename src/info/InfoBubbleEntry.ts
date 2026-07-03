import type { GeoPoint } from '../features';
import type { MarkerIcon } from '../marker/MarkerIcon';
import type { Offset } from '../types';

export interface InfoBubbleEntry {
    readonly id: string;
    readonly positionProvider: () => GeoPoint;
    readonly icon: MarkerIcon | null;
    readonly tailOffset: Offset;
    readonly content: unknown;
}
