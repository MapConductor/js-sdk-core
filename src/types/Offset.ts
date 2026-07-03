export interface Offset {
    x: number;
    y: number;
}

export function createOffset(params: {
    x: number,
    y: number,
}): Offset {
    return {
        x: params.x,
        y: params.y,
    }
}