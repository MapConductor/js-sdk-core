/*
 * Copyright 2013 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * port from here
 * https://github.com/googlemaps/android-maps-utils/blob/70a77b066b8391da06a2d708792de8337bf5d3b6/library/src/main/java/com/google/maps/android/projection/SphericalMercatorProjection.java
 */

import { createOffset, Offset } from "../types"
import { Projection } from "./Projection"
import { toDegrees, toRadians } from "../sperical/utils"
import { GeoPoint, GeoPointInterface, createGeoPoint } from "../features"

class WGS84class implements Projection {
    project(position: GeoPointInterface): Offset {
        const x = position.longitude / 360 + .5
        const siny = Math.sin(toRadians(position.latitude))
        const y = 0.5 * Math.log((1 + siny) / (1 - siny)) / -(2 * Math.PI) + .5
        return createOffset({
            x: x * 256,
            y: y * 256,
        });
    }

    unproject(point: Offset): GeoPoint {
        const x = point.x / 256 - 0.5
        const lng = x * 360
        const y = .5 - point.y / 256
        const lat = 90 - toDegrees(Math.atan(Math.exp(-y * 2 * Math.PI)) * 2)
        return createGeoPoint({
            latitude: lat,
            longitude: lng,
            altitude: null,
        });
    }
}

export const WGS84 = new WGS84class();
