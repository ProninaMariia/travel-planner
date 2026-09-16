# Travel Planner — v2 (in progress)

Rewrite of the planner around a new data model. The deployed v1 lives in
`../travel-planner` and is untouched until this replaces it.

## Running

```bash
npm install
npm run dev     # the app
npm test        # the scheduler's own tests, no install needed
```

## The model

A trip has a **mode**, picked on the first screen: `car` or `transit`.
The mode is what the first screen asks about, and asking it is also what tells a
first-time visitor what the app is for.

A leg is two different shapes, not one shape with optional fields:

- `car` — distance and minutes, from the router, an estimate, or typed by hand.
- `transit` — departure and arrival from a timetable. **No `km` field exists**,
  so kilometres cannot leak into a public-transport trip.

Durations are **minutes** everywhere. `formatMinutes` is the only place they
become `1h30`, so decimal hours like `0.75` cannot appear.

Free time is derived, never stored: the gap between finishing at a stop and the
next departure. Negative means the traveller misses the connection, and it is
flagged.

## Layout

```
src/
  types.ts       the model
  time.ts        local-time helpers and the one formatter
  schedule.ts    computeSchedule(trip) — pure, tested
  storage.ts     localStorage + a blank trip
  places.ts      Nominatim search and OSRM road legs
  App.tsx        the shell
  components/    ModePicker, StopCard, LegRow
tests/
  schedule.test.ts
```

## Not here yet

The map, the sandbox for "maybe" stops, and JSON import/export. They were left
out of this milestone on purpose: the point of it is that the model and the
schedule are right before any of that is built on them.
