import { GeoPoint } from "../features/GeoPoint";
import { createOppositeMeridianPoint } from "./CreateOppositeMeridianPoint";
import { interpolateAtMeridianGeodesic } from "./InterpolateAtMeridianGeodesic";
import { interpolateAtMeridianLinear } from "./InterpolateAtMeridianLinear";

function interpolateAtMeridian({
    from,
    to,
    geodesic,
}: {
    from: GeoPoint;
    to: GeoPoint;
    geodesic: boolean;
}): GeoPoint {
    return geodesic ?
        interpolateAtMeridianGeodesic(from, to) :
        interpolateAtMeridianLinear(from, to);
}

export function splitByMeridian(points: GeoPoint[], geodesic: boolean): GeoPoint[][] {
    if (points.length === 0) return [];

    const results: GeoPoint[][] = [];
    let fragment: GeoPoint[] = [];

    for (let i = 0; i < points.length; i += 1) {
        const currentPoint = points[i];

        if (fragment.length === 0) {
            fragment.push(currentPoint);
            continue;
        }

        const previousPoint = fragment[fragment.length - 1];
        const prevLng = previousPoint.longitude;
        const currLng = currentPoint.longitude;
        const lngDiff = currLng - prevLng;
        const crossesMeridian = Math.abs(lngDiff) > 180.0;

        if (!crossesMeridian) {
            fragment.push(currentPoint);
        } else {
            const meridianPoint = interpolateAtMeridian({ from: previousPoint, to: currentPoint, geodesic });
            fragment.push(meridianPoint);

            results.push([...fragment]);
            fragment = [];

            const oppositeMeridianPoint = createOppositeMeridianPoint(meridianPoint);
            fragment.push(oppositeMeridianPoint);
            fragment.push(currentPoint);
        }
    }

    if (fragment.length > 0) {
        results.push([...fragment]);
    }

    return results;
}
