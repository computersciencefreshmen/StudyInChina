# Interactive student-city map — 2026-09-29

## Objective

Help applicants locate catalogue cities, compare nearby options, and reach city
and university records. The user selected a real draggable, zoomable basemap with
familiar map/list interaction. Admissions facts continue to come from the
existing catalogue and official-evidence workflow.

## Components and data flow

The city route passes public cities and university identities into `CityExplorer`.
Search, region and sort state produce one visible city set; search matches city,
province and university names. URL parameters preserve these controls and the map
or directory view.

`CityMapWorkspace` owns selection and renders the synchronized result list,
city details and university links. It passes the visible set and selected ID to
`CityMapCanvas`. The canvas lazily imports Leaflet, creates viewport-only OSM
tiles and draws catalogue city-centre coordinates. Map clicks update the list;
list clicks highlight and pan to the corresponding pin. Cities without usable
coordinates retain their list and detail paths.

The canvas keeps its imperative map instance behind a React ref. Markers rebuild
only when displayed positions or names change, preserving the viewport during
unrelated renders. Filtering fits the result extent; selection preserves zoom.
Desktop selection applies a screen-space horizontal offset to avoid the left-side
detail card. Mobile details sit below the canvas and keep ordinary centring.
ResizeObserver updates dimensions; cleanup releases map events and observers.

## Choices and trade-offs

- **Leaflet and OSM raster tiles:** real geographic interaction without a Google
  API key or separate geocoding. Availability remains external; the list and
  markers continue working during tile failures.
- **Shared selection:** one city governs every panel, supporting both geographic
  and text navigation without maintaining two competing selections.
- **Catalogue coordinates:** avoids fabricated campus positions and new lookup
  requests. Markers explicitly represent recorded city centres.
- **Responsive layout:** desktop uses a result pane beside the map; smaller
  screens stack map, details and list. Existing mobile directory defaults defer
  the map until requested.
- **External Google Maps action:** an ordinary search link supports further
  exploration without embedding or copying Google's map data.

## Resilience and verification

Initialization and tile availability are separate states. Leaflet can emit
`load` after failed tiles, so errors persist until a successful explicit retry.
Import attempts share one pending promise; rejected imports reset for Retry, and
unmounted effects cannot initialize stale containers. Marker labels use DOM text
nodes rather than interpolated HTML. Pins and controls offer keyboard interaction,
visible focus and 44-pixel targets.

Unit tests mock Leaflet for coordinate filtering, selection, safe labels, retry,
resize, StrictMode cleanup and desktop/mobile centring. Browser tests intercept
OSM URLs with labelled fixtures, avoiding automated community-tile traffic.
A separate single HEAD observation records provider reachability. Final build
and browser visual verification remain part of the integrated website release.

Provider attribution, caching, Referer handling, external links and the unused
static-map candidate are recorded in [map-compliance.md](../map-compliance.md).
