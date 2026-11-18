# Travel Planner — v2 (in progress)

Trip planner: route, per-stop activities and a day-by-day schedule that
respects the traveller's day and the curfew.

## Running

```bash
npm install
npm run dev     # the app
npm test        # the scheduler's own tests (Kyiv time), no install needed
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

## How the schedule is computed

- **The start time is kept as set**, even before `dayStart` — long drives
  start at 4–5 am, right after curfew. Only the curfew can move it.
- **My day** (`dayStart`..`dayEnd`, editable in the header): mornings after a
  night start at `dayStart`; the car does not drive after `dayEnd`.
- **Curfew**: no driving, and no arriving by car, during the curfew of either
  end of a leg. Activities stop at the curfew. A train that arrives or leaves
  during curfew is kept as timetabled and flagged — the ticket works as a pass.
- **Activities are never cut in two.** One that does not fit before the night
  moves whole to the next morning.
- **Overnight** means one night: leave the morning after arriving. When the
  next drive does not fit in what is left of today, the traveller stays the
  night anyway and the card says why. Only a drive longer than a whole day is
  split on the road, and that is flagged.
- **Days** are calendar days from the start to the end, quiet ones included.

Curfew hours live in `src/curfew.ts`, keyed by the ISO 3166-2 region code the
geocoder returns. There is no official feed, so the table carries the date it
was checked, and each stop's hours can be corrected by hand.

## Layout

```
src/
  types.ts       the model
  time.ts        local-time helpers and the one formatter
  windows.ts     allowed hours (day window minus curfew) and walking time through them
  curfew.ts      curfew table by region, and per-stop overrides
  schedule.ts    computeSchedule(trip) — pure, tested
  storage.ts     localStorage + a blank trip
  places.ts      Nominatim search and OSRM road legs
  App.tsx        the shell
  components/    ModePicker, StopCard, LegRow, RouteMap
tests/
  schedule.test.ts
```

## Not here yet

The sandbox for "maybe" stops, JSON import/export, curfews of regions a leg
only passes through, and time zones for international legs.
