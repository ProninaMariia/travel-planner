import type { Trip, Stop, Settings } from './types.ts';
import {
  parseLocal, dayKey, addMinutes, minutesBetween, atMinutes, nextDayAt, minutesOfDay,
} from './time.ts';

export interface ScheduledStop {
  stopId: string;
  arrive: Date;
  /** When the last planned activity here finishes. */
  activitiesEnd: Date;
  depart: Date;
  /** Idle minutes between finishing here and leaving. Negative = the traveller is late. */
  freeMinutes: number | null;
  warnings: string[];
  day: string;
}

export interface DayTotals {
  key: string;
  travelMinutes: number;
  activityMinutes: number;
  km: number;
}

export interface Schedule {
  stops: ScheduledStop[];
  days: DayTotals[];
  totals: {
    km: number;
    travelMinutes: number;
    activityMinutes: number;
    days: number;
    end: Date | null;
  };
}

interface Window { start: number; end: number; }

function travelWindow(s: Settings): Window | null {
  const start = minutesOfDay(s.dayStart);
  const end = minutesOfDay(s.dayEnd);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

type Adder = (from: Date, to: Date, kind: 'travel' | 'activity', km: number) => void;

/**
 * Spend `minutes` from `clock`, pausing overnight when a travel window applies.
 * Returns where the clock lands and whether it had to cross a day boundary.
 */
function spend(
  clock: Date, minutes: number, win: Window | null,
  kind: 'travel' | 'activity', km: number, add: Adder,
): { end: Date; split: boolean } {
  if (minutes <= 0) return { end: clock, split: false };

  if (!win) {
    const end = addMinutes(clock, minutes);
    add(clock, end, kind, km);
    return { end, split: false };
  }

  let t = clock;
  let left = minutes;
  let split = false;
  let guard = 0;

  while (left > 0 && guard++ < 500) {
    const dayEnd = atMinutes(t, win.end);
    if (t >= dayEnd) { t = nextDayAt(t, win.start); split = true; continue; }

    const available = minutesBetween(t, dayEnd);
    if (available <= 0) { t = nextDayAt(t, win.start); split = true; continue; }

    const used = Math.min(available, left);
    const to = addMinutes(t, used);
    add(t, to, kind, km * (used / minutes));
    t = to;
    left -= used;
    if (left > 0) { t = nextDayAt(t, win.start); split = true; }
  }

  return { end: t, split };
}

function activityMinutes(stop: Stop, s: Settings): number {
  const sum = stop.activities.reduce((n, a) => n + (a.minutes || 0), 0);
  return sum > 0 ? sum + (s.stopBufferMinutes || 0) : 0;
}

export function computeSchedule(trip: Trip): Schedule {
  const s = trip.settings;
  const win = travelWindow(s);
  const dayMap = new Map<string, DayTotals>();

  /** Attribute a span to the days it actually covers, splitting at midnight. */
  const add: Adder = (from, to, kind, km) => {
    let cursor = from;
    const totalMinutes = Math.max(1, minutesBetween(from, to));
    while (cursor < to) {
      const midnight = nextDayAt(cursor, 0);
      const chunkEnd = midnight < to ? midnight : to;
      const key = dayKey(cursor);
      let day = dayMap.get(key);
      if (!day) { day = { key, travelMinutes: 0, activityMinutes: 0, km: 0 }; dayMap.set(key, day); }
      const chunk = minutesBetween(cursor, chunkEnd);
      if (kind === 'travel') day.travelMinutes += chunk; else day.activityMinutes += chunk;
      day.km += km * (chunk / totalMinutes);
      cursor = chunkEnd;
    }
  };

  const out: ScheduledStop[] = [];
  let clock = parseLocal(trip.start) ?? new Date();

  trip.stops.forEach((stop, i) => {
    const warnings: string[] = [];
    let arrive: Date;

    if (i === 0) {
      arrive = clock;
    } else {
      const leg = stop.leg;
      if (!leg) {
        warnings.push('no-leg');
        arrive = clock;
      } else if (leg.mode === 'transit') {
        // Absolute times from a timetable. No day window, no distance.
        const dep = parseLocal(leg.departAt);
        const arr = parseLocal(leg.arriveAt);
        if (!dep || !arr) { warnings.push('bad-times'); arrive = clock; }
        else {
          if (arr < dep) warnings.push('arrives-before-it-leaves');
          add(dep, arr, 'travel', 0);
          arrive = arr;
        }
      } else {
        if (win && clock >= atMinutes(clock, win.end)) clock = nextDayAt(clock, win.start);
        const r = spend(clock, leg.minutes, win, 'travel', leg.km, add);
        arrive = r.end;
        if (r.split) warnings.push('overnight-en-route');
      }
    }

    if (stop.arrival.kind === 'pinned') {
      const pinned = parseLocal(stop.arrival.at);
      if (pinned) {
        if (pinned < addMinutes(arrive, -1)) warnings.push('pinned-earlier-than-possible');
        arrive = pinned;
      }
    }

    const stay = activityMinutes(stop, s);
    const spent = spend(arrive, stay, win, 'activity', 0, add);
    const activitiesEnd = spent.end;
    if (spent.split) warnings.push('activities-spill-over');

    // When we leave depends on what comes next.
    const next = trip.stops[i + 1];
    let depart = activitiesEnd;
    let freeMinutes: number | null = null;

    if (next && next.leg && next.leg.mode === 'transit') {
      const dep = parseLocal(next.leg.departAt);
      if (dep) {
        depart = dep;
        freeMinutes = minutesBetween(activitiesEnd, dep);
        if (freeMinutes < 0) warnings.push('will-miss-departure');
      }
    } else if (stop.overnight) {
      depart = nextDayAt(activitiesEnd, win ? win.start : 0);
    }

    clock = depart;
    out.push({
      stopId: stop.id, arrive, activitiesEnd, depart,
      freeMinutes, warnings, day: dayKey(arrive),
    });
  });

  const days = [...dayMap.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const totals = days.reduce(
    (t, d) => ({
      km: t.km + d.km,
      travelMinutes: t.travelMinutes + d.travelMinutes,
      activityMinutes: t.activityMinutes + d.activityMinutes,
    }),
    { km: 0, travelMinutes: 0, activityMinutes: 0 },
  );

  return {
    stops: out,
    days,
    totals: {
      ...totals,
      days: days.length,
      end: out.length ? out[out.length - 1].depart : null,
    },
  };
}
