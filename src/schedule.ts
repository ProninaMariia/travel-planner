import type { Trip, Stop } from './types.ts';
import {
  parseLocal, dayKey, addMinutes, minutesBetween, nextDayAt, minutesOfDay, clockMinutes, wallClock,
} from './time.ts';
import { resolveCurfew, type ResolvedCurfew } from './curfew.ts';
import { daily, curfewIntervals, subtract, covers, nextRun, type Intervals } from './windows.ts';

/**
 * The rules, in one place:
 *
 * - Driving happens only inside the traveller's day (dayStart..dayEnd) and
 *   outside the curfew of both ends of the leg. A drive that cannot finish
 *   inside one day is flagged: nobody wants to pause on the hard shoulder.
 * - Activities start no earlier than dayStart, may run into the evening, and
 *   stop at the curfew. One activity is never cut in two: if it does not fit,
 *   it moves whole to the next morning.
 * - "Overnight" means one night here: leave the morning after arriving.
 * - When the next leg cannot start today, the traveller stays the night
 *   anyway, and the card says why.
 * - Days are calendar days, from the start to the end of the trip.
 * - Transit times come from a timetable and are never moved; the curfew only
 *   adds warnings, because a train ticket works as a pass.
 */

export type Warning =
  | 'overnight-en-route'
  | 'activity-moved'
  | 'activity-too-long'
  | 'will-miss-departure'
  | 'arrives-before-it-leaves'
  | 'bad-times'
  | 'no-leg'
  | 'leg-unknown'
  | 'arrives-during-curfew'
  | 'departs-during-curfew';

/** Not a problem, just the reason the plan looks the way it does. */
export type Note = 'night-auto' | 'wait-day' | 'wait-curfew';

export interface ScheduledActivity {
  id: string;
  start: Date;
  end: Date;
  /** Did not fit before the night, so it was moved to the next morning. */
  moved: boolean;
}

export interface ScheduledStop {
  stopId: string;
  arrive: Date;
  activities: ScheduledActivity[];
  /** When the last planned activity here finishes. */
  activitiesEnd: Date;
  depart: Date;
  /** Idle minutes between finishing here and a timetable departure. Negative = late. */
  freeMinutes: number | null;
  warnings: Warning[];
  notes: Note[];
  /** A night falls between arriving here and leaving. */
  nightHere: boolean;
  /** Calendar day of arrival, 'YYYY-MM-DD'. */
  day: string;
  curfew: ResolvedCurfew;
}

export interface DayTotals {
  key: string;
  travelMinutes: number;
  activityMinutes: number;
  km: number;
}

export interface Schedule {
  stops: ScheduledStop[];
  /** Every calendar day of the trip, in order, including days with nothing planned. */
  days: DayTotals[];
  totals: {
    km: number;
    travelMinutes: number;
    activityMinutes: number;
    days: number;
    end: Date | null;
  };
}

type Adder = (from: Date, to: Date, kind: 'travel' | 'activity', km: number) => void;

/** The small hours: a stay that spans 03:00 is a night spent somewhere. */
const NIGHT_MARK = 3 * 60;

function nextNightMark(t: Date): Date {
  return clockMinutes(t) < NIGHT_MARK ? wallClock(t, NIGHT_MARK) : wallClock(t, NIGHT_MARK, 1);
}

const spansNight = (a: Date, b: Date): boolean => nextNightMark(a) < b;

const later = (a: Date, b: Date): Date => (a > b ? a : b);

/** Drive for `minutes` from `from`, inside the allowed hours only. */
function drive(
  from: Date, minutes: number, iv: Intervals, km: number, add: Adder,
): { end: Date; split: boolean } {
  if (minutes <= 0) return { end: from, split: false };

  let t = from;
  let left = minutes;
  let split = false;
  let started = false;

  for (let guard = 0; left > 0 && guard < 1000; guard++) {
    const run = nextRun(t, iv);
    if (!run) {
      // Nothing is ever allowed (a curfew covering the whole driving day).
      const end = addMinutes(t, left);
      add(t, end, 'travel', km * (left / minutes));
      return { end, split: true };
    }
    if (started && run.start > t) split = true;
    started = true;

    const used = Math.min(left, minutesBetween(run.start, run.end));
    const to = addMinutes(run.start, used);
    add(run.start, to, 'travel', km * (used / minutes));
    t = to;
    left -= used;
  }
  return { end: t, split };
}

/** Find room for one activity of `minutes`, whole, at or after `t`. */
function place(
  t: Date, minutes: number, iv: Intervals,
): { start: Date; end: Date; moved: boolean; tooLong: boolean } {
  if (minutes <= 0) return { start: t, end: t, moved: false, tooLong: false };

  let cursor = t;
  for (let k = 0; k < 60; k++) {
    const run = nextRun(cursor, iv);
    if (!run) break;
    if (minutesBetween(run.start, run.end) >= minutes) {
      return { start: run.start, end: addMinutes(run.start, minutes), moved: spansNight(t, run.start), tooLong: false };
    }
    cursor = run.end;
  }

  // Longer than any stretch a day allows: plan it from the first allowed moment.
  const run = nextRun(t, iv);
  const start = run ? run.start : t;
  return { start, end: addMinutes(start, minutes), moved: spansNight(t, start), tooLong: true };
}

function legIsUnknown(stop: Stop): boolean {
  return stop.leg?.mode === 'car' && stop.leg.km <= 0 && stop.leg.minutes <= 0;
}

export function computeSchedule(trip: Trip): Schedule {
  const s = trip.settings;
  const dayStartMin = minutesOfDay(s.dayStart) ?? 0;
  const roadWindow = daily(s.dayStart, s.dayEnd);
  const activityWindow = daily(s.dayStart, '24:00');

  const curfews = trip.stops.map(resolveCurfew);
  const blocked = curfews.map(c => curfewIntervals(c.curfew));
  /** Driving between stops a and b: inside the day, outside both curfews. */
  const roadBetween = (a: number, b: number): Intervals =>
    subtract(roadWindow, [...blocked[a], ...blocked[b]]);

  const dayMap = new Map<string, DayTotals>();
  const dayOf = (key: string): DayTotals => {
    let day = dayMap.get(key);
    if (!day) { day = { key, travelMinutes: 0, activityMinutes: 0, km: 0 }; dayMap.set(key, day); }
    return day;
  };

  /** Attribute a span to the days it actually covers, splitting at midnight. */
  const add: Adder = (from, to, kind, km) => {
    let cursor = from;
    const totalMinutes = Math.max(1, minutesBetween(from, to));
    while (cursor < to) {
      const midnight = nextDayAt(cursor, 0);
      const chunkEnd = midnight < to ? midnight : to;
      const day = dayOf(dayKey(cursor));
      const chunk = minutesBetween(cursor, chunkEnd);
      if (kind === 'travel') day.travelMinutes += chunk; else day.activityMinutes += chunk;
      day.km += km * (chunk / totalMinutes);
      cursor = chunkEnd;
    }
  };

  const start = parseLocal(trip.start) ?? new Date();
  const out: ScheduledStop[] = [];
  /** When the traveller leaves the previous stop. */
  let clock = start;

  trip.stops.forEach((stop, i) => {
    const warnings: Warning[] = [];
    const notes: Note[] = [];
    let arrive: Date;

    // ---- getting here ----
    if (i === 0) {
      arrive = clock;
    } else if (!stop.leg) {
      warnings.push('no-leg');
      arrive = clock;
    } else if (stop.leg.mode === 'transit') {
      const dep = parseLocal(stop.leg.departAt);
      const arr = parseLocal(stop.leg.arriveAt);
      if (!dep || !arr) {
        warnings.push('bad-times');
        arrive = clock;
      } else {
        if (arr < dep) warnings.push('arrives-before-it-leaves');
        add(dep, arr, 'travel', 0);
        arrive = arr;
        if (covers(blocked[i], arr)) warnings.push('arrives-during-curfew');
      }
    } else {
      if (legIsUnknown(stop)) warnings.push('leg-unknown');
      const r = drive(clock, stop.leg.minutes, roadBetween(i - 1, i), stop.leg.km, add);
      arrive = r.end;
      if (r.split) warnings.push('overnight-en-route');
    }

    // ---- what happens here ----
    const here = subtract(activityWindow, blocked[i]);
    const activities: ScheduledActivity[] = [];
    let t = arrive;
    const buffer = stop.activities.some(a => a.minutes > 0) ? (s.stopBufferMinutes || 0) : 0;
    const plan = buffer > 0
      ? [...stop.activities, { id: '__buffer', title: '', minutes: buffer }]
      : stop.activities;

    for (const a of plan) {
      const p = place(t, a.minutes || 0, here);
      if (p.end > p.start) add(p.start, p.end, 'activity', 0);
      if (p.moved && !warnings.includes('activity-moved')) warnings.push('activity-moved');
      if (p.tooLong && !warnings.includes('activity-too-long')) warnings.push('activity-too-long');
      if (a.id !== '__buffer') activities.push({ id: a.id, start: p.start, end: p.end, moved: p.moved });
      t = p.end;
    }
    const activitiesEnd = t;

    // ---- leaving ----
    let earliest = activitiesEnd;
    if (stop.overnight) {
      const mark = nextNightMark(arrive);
      earliest = later(earliest, later(mark, wallClock(mark, dayStartMin)));
    }

    const next = trip.stops[i + 1];
    let depart = earliest;
    let freeMinutes: number | null = null;

    if (next?.leg?.mode === 'transit') {
      const dep = parseLocal(next.leg.departAt);
      if (dep) {
        depart = dep;
        freeMinutes = minutesBetween(activitiesEnd, dep);
        if (freeMinutes < 0) warnings.push('will-miss-departure');
        if (covers(blocked[i], dep)) warnings.push('departs-during-curfew');
      }
    } else if (next?.leg?.mode === 'car' && next.leg.minutes > 0) {
      const road = roadBetween(i, i + 1);
      const run = nextRun(earliest, road);
      if (run) {
        depart = run.start;
        // Not enough of today left for this drive, and tomorrow has more:
        // set off in the morning instead of stopping halfway on the road.
        const leftToday = minutesBetween(run.start, run.end);
        if (leftToday < next.leg.minutes) {
          const tomorrow = nextRun(run.end, road);
          if (tomorrow && minutesBetween(tomorrow.start, tomorrow.end) > leftToday) depart = tomorrow.start;
        }
      }
      if (depart > earliest) {
        if (spansNight(earliest, depart)) {
          if (!stop.overnight) notes.push('night-auto');
        } else {
          notes.push(covers(roadWindow, earliest) ? 'wait-curfew' : 'wait-day');
        }
      }
    }

    clock = depart;
    out.push({
      stopId: stop.id, arrive, activities, activitiesEnd, depart, freeMinutes,
      warnings, notes, nightHere: spansNight(arrive, depart),
      day: dayKey(arrive), curfew: curfews[i],
    });
  });

  // Every calendar day from the start to the end, including quiet ones.
  const end = out.length ? out[out.length - 1].depart : null;
  const days: DayTotals[] = [];
  if (end) {
    const lastKey = dayKey(end);
    for (let k = 0; k < 400; k++) {
      const key = dayKey(wallClock(start, 12 * 60, k));
      if (key > lastKey) break;
      days.push(dayMap.get(key) ?? { key, travelMinutes: 0, activityMinutes: 0, km: 0 });
    }
  }

  const totals = days.reduce(
    (acc, d) => ({
      km: acc.km + d.km,
      travelMinutes: acc.travelMinutes + d.travelMinutes,
      activityMinutes: acc.activityMinutes + d.activityMinutes,
    }),
    { km: 0, travelMinutes: 0, activityMinutes: 0 },
  );

  return { stops: out, days, totals: { ...totals, days: days.length, end } };
}
