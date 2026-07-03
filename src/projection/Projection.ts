import { GeoPoint, GeoPointInterface } from "../features"
import { Offset } from "../types"

export interface Projection {
    project(position: GeoPointInterface): Offset

    unproject(point: Offset): GeoPoint
}
