/**
 * A MapLibre-style map with nothing in it but a background.
 *
 * What a provider shows for "no basemap" when it is built on MapLibre (or
 * takes a MapLibre style): the same colour as the device-side blank styles in
 * android-sdk-core / ios-sdk-core. A map that draws its whole viewport itself
 * -- vector tiles rendered on the client, say -- fetches and paints the basemap
 * under it for nobody; this is the style that fetches nothing.
 */
export const BLANK_MAP_STYLE = {
  version: 8 as const,
  name: 'blank',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background' as const,
      paint: { 'background-color': '#f2efe9' },
    },
  ],
};

/** [BLANK_MAP_STYLE] as a URL, for providers whose design carries a style URL. */
export const BLANK_MAP_STYLE_URL =
  'data:application/json,' + encodeURIComponent(JSON.stringify(BLANK_MAP_STYLE));
