# Interactive map service and source record

Reviewed: **2026-09-29**. The selected implementation uses Leaflet 1.9.4 with
OpenStreetMap Standard raster tiles, replacing the coordinate-only city plot.
This records the actual provider and operation; it does not claim a government
map-review certificate or provider endorsement.

## Homepage background

The homepage `CityConstellation` also displays a locally served screenshot of
[Google Maps](https://www.google.com/maps/@36,104,5z?hl=en), captured on
2026-09-29, at `/maps/china-google-maps-2026-09-29.jpg`. The original Google Maps
logo and map-data credit remain in the image, with an additional readable source
link beneath it. The screenshot is 1848 × 920 pixels, from a 1920 × 1080 viewport
with the top 160 pixels and left 72 pixels of interface excluded. Its centre is
36°N, 104°E, zoom 5. Homepage pins use this camera's Web Mercator projection and
the same aspect ratio on every screen, so resizing does not move a pin relative
to the geographic background. The static screenshot is an orientation view;
the city-directory map retains the interactive OpenStreetMap service below.
Loading the homepage background makes no visitor request to Google Maps.

## Current service

| Item | Recorded implementation |
| --- | --- |
| Tile endpoint | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| Provider | OpenStreetMap Foundation community tile service |
| Renderer | Pinned `leaflet@1.9.4`, imported when the map component mounts |
| Attribution | Continuously visible `© OpenStreetMap contributors`, linked to the [copyright and licence page](https://www.openstreetmap.org/copyright) |
| Provider rules | [Standard raster Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) and [OSMF Terms of Use](https://osmfoundation.org/wiki/Terms_of_Use) |
| Privacy reference | [OSMF Privacy Policy](https://osmfoundation.org/wiki/Privacy_Policy); the site's localized privacy page explains direct tile requests |
| City-marker source | Recorded city-centre coordinates in `content/data/cities.json`, separate from the provider's basemap |
| Implementation | `CityMapCanvas.tsx` and `CityMapWorkspace.tsx` in `src/components/features/` |

OpenStreetMap's underlying data uses the Open Database License. The linked
copyright page explains the licence and credit requirements. Attribution remains
visible beside the selected-city panel and during loading or tile failure.

## Network and interaction behavior

The active viewport requests tiles with `keepBuffer: 0`, `updateWhenIdle: true`,
`updateWhenZooming: false`, and no world wrapping. There is no prefetch, offline
download, tile archive, or background geography crawl. Automated pan/zoom tests
intercept the provider URL and return labelled synthetic fixtures.

The browser honors normal cache headers. There is no proxy, cache-busting query,
or `no-cache` override. The site's `strict-origin-when-cross-origin` policy retains
the origin Referer for tile images; the browser supplies its normal User-Agent.
These choices implement the provider's [tile operating requirements](https://operations.osmfoundation.org/policies/tiles/).

The service is best effort. Failed tiles show an unavailable message and Retry
action; city markers, list and detail links remain usable. A completed Leaflet
batch does not mean success if tiles failed. Precise visitor location is never
requested. Direct tile requests expose ordinary connection information to the
provider, as described in the site's privacy notice and the
[provider's terms](https://osmfoundation.org/wiki/Terms_of_Use).

## Coordinates and Google Maps links

Markers use finite catalogue coordinates within the accepted city range.
Missing coordinates remain visible in the list and never receive invented
positions. City centres do not represent university campus locations.

The catalogue currently contains 27 coordinate pairs among 62 cities. These are
approximate city locations: the data model records no coordinate-specific source,
coordinate system or precision, and this release did not independently geocode
them. The UI describes catalogue locations without claiming newly reviewed
coordinates. The other 35 cities remain searchable without pins. See the
[coordinate provenance inventory](../quality/audit-2026-09-29-city-coordinate-provenance.json).

The Google Maps action is an external `https://www.google.com/maps/search/` URL
with `api=1` and a coordinate or city-name query, opened only when followed.
The city-directory map is not an embedded Google API and requires no API key;
it does not use Google geocoding. The separate homepage screenshot is described
above. See the official
[Maps URLs documentation](https://developers.google.com/maps/documentation/urls/get-started).

## Historical standard-map candidate

The earlier static candidate remains a historical research entry:

- [Ministry of Natural Resources Standard Map Service](https://bzdt.tianditu.gov.cn/).
- Description: 中国地图 1∶740万 对开（横版、界线版、无邻国、含南海诸岛附图）.
- Previously recorded candidate approval number: `GS(2023)2767号`.
- Previously recorded catalogue ID: `4o28b0625501ad13015501ad2bfc2187`.

That artwork is not used. Its identifier is not applied to OpenStreetMap tiles,
the interactive composition, or city markers. No approval number is invented or
presented as covering the current site. A future official static asset or provider
change needs its own accurate source and usage record; this historical entry is
not a licence or approval for such reuse.

## Bounded availability observation

At **2026-09-29 06:30:03 UTC**, one identified, read-only `HEAD` request to
`https://tile.openstreetmap.org/4/12/6.png` returned HTTP 200 and `image/png`, with
provider cache directives `max-age=529095`, `stale-while-revalidate=604800`, and
`stale-if-error=604800`. No tile bytes were downloaded or prefetched. This is one
successful observation from the operator's connection, not continuous or worldwide
availability. Mocked browser tests verify interaction, not provider geography or uptime.
