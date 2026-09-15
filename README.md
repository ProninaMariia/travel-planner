# Travel Planner

A single-file trip planner: build a route, give each stop a list of things to do,
and see when you actually arrive, when you leave, and where each day ends.

Everything runs in the browser — no build step, no server, no account.

## Live demo

- [Demo](https://proninamariia.github.io/travel-planner/)

## What it does

- **Route** — add stops by name; the planner looks the place up and keeps its coordinates.
- **Schedule** — activities take time, driving takes time, and the planner spreads all of it
  across days, respecting the hours you are willing to be on the road.
- **Day breakdown** — every day gets a header with its distance, driving time and time at stops.
- **Sandbox** — a parking area for "maybe, if there's time" stops. Drag them in and out of the
  route; parked stops never count toward the totals.
- **Map** — opens in its own tab: one view per day plus the whole trip, real road geometry where
  it is available, and a link out to Google Maps.
- **Manual overrides** — pin an arrival time, mark an overnight stay, or type the distance and
  duration of any leg by hand.

## How distances are calculated

Three sources, in order of priority:

1. **Manual** — whatever you type into the km / h fields of a leg beats everything else.
2. **Road** — with online lookups enabled, the route comes from OSRM and is cached.
3. **Estimate** — straight-line distance x road factor / average speed. Used when a stop has no
   coordinates or the routing service is unreachable.

The badge on each leg shows which of the three is in use.

## Data

Trips are autosaved to `localStorage` in the browser that created them. There is no server and no
sync, so to move a trip to another machine use **Data / JSON** — copy or download it there, and
paste it back here.

Clearing the browser's site data deletes the trip, so export it first if it matters.

## Running locally

```bash
git clone https://github.com/ProninaMariia/travel-planner.git
cd travel-planner
```

Then open `index.html` in a browser. There is nothing to install.

Place search, road distances and map tiles need a connection. Switch **online lookups** off in
Settings to work entirely offline: stops are then added exactly as typed and every distance falls
back to an estimate.

## Built with

- Plain HTML, CSS and JavaScript — no frameworks, no dependencies
- [Nominatim](https://nominatim.openstreetmap.org) for place search
- [OSRM](https://project-osrm.org) for road distances
- OpenStreetMap raster tiles, drawn on a hand-rolled pan/zoom map with an SVG overlay

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
