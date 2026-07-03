import { Offset } from "../types/Offset";

export function closestPointOnSegment({
    startPoint,
    endPoint,
    testPoint,
}: {
    startPoint: Offset;
    endPoint: Offset;
    testPoint: Offset;
}): Offset {
    const segmentVector = {
        x: endPoint.x - startPoint.x,
        y: endPoint.y - startPoint.y,
    };
    const pointVector = {
        x: testPoint.x - startPoint.x,
        y: testPoint.y - startPoint.y,
    };
    const segmentLengthSquared = segmentVector.x * segmentVector.x + segmentVector.y * segmentVector.y;
    if (segmentLengthSquared === 0.0) return startPoint;

    const projectionRatio = Math.max(
        0.0,
        Math.min(
            1.0,
            (pointVector.x * segmentVector.x + pointVector.y * segmentVector.y) / segmentLengthSquared,
        ),
    );

    return {
        x: startPoint.x + projectionRatio * segmentVector.x,
        y: startPoint.y + projectionRatio * segmentVector.y,
    };
}
