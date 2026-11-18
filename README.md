# Travel Planner — v2 (in progress)

Trip planner: route, per-stop activities and a day-by-day schedule that
respects the traveller's day and the curfew.

## Running

```bash
npm install
npm run dev     # the app
npm test        # the scheduler's own tests (Kyiv time, Node 22.6+), no install needed
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

People travel very differently, so the planner assumes as little as it can.

- **Only the curfew is a hard limit**: no driving, and no arriving by car,
  during the curfew of either end of a leg. A train that arrives or leaves
  during curfew is kept as timetabled and flagged — the ticket works as a pass.
- **The start time is kept as set**; only the curfew can move it.
- **"I don't drive after HH:MM"** is an optional setting, off by default.
- **After a night**, set off at the `morning` setting (05:00 by default), or
  when the curfew ends if that is later.
- **Activities start on arrival** and stop at the curfew. One is never cut in
  two: if it does not fit, it moves whole.
- **When the next drive mostly does not fit before the curfew**, the night is
  spent at the stop and the card says why. When most of it fits, the car goes
  and the card suggests a night stop on the way.
- **Tiredness is advice, never a rule.** After 4.5 h at the wheel a 45-min
  break is recommended (with two drivers, a 15-min swap), and more than 9 h of
  driving in a day is pointed out. These are the professional drivers' limits
  (Order 340 / EU 561/2006), used as a safety benchmark. A break is in the
  arrival time only when the traveller ticks it.
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
