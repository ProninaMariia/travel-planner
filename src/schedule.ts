import type { Trip, Stop } from './types.ts';
import {
  parseLocal, dayKey, addMinutes, minutesBetween, nextDayAt, minutesOfDay, clockMinutes, wallClock,
} from './time.ts';
import { resolveCurfew, type ResolvedCurfew } from './curfew.ts';
import {
  daily, curfewIntervals, subtract, union, covers, nextRun, type Intervals, type Allowed,
} from './windows.ts';

/**
 * The rules, in one place. People travel very differently, so the planner
 * assumes as little as it can:
 *
 * - The only hard limit is the curfew: no driving, and no arriving by car,
 *   during the curfew at either end of a leg.
 * - The start time is kept as set; only the curfew can move it.
 * - "I don't drive after HH:MM" is an optional setting. Off by default.
 * - Activities start as soon as the traveller arrives, and stop at the curfew.
 *   One activity is never cut in two: if it does not fit, it moves whole.
 * - "Overnight" means one night here; the morning departure is the `morning`
 *   setting, or the end of the curfew if that is later.
 * - When the next drive cannot be done before the curfew (or the traveller's
 *   own limit), they stay the night here, and the card says why.
 * - Tiredness is advice, never a rule: after 4.5 h at the wheel a break is
 *   recommended (45 min; with two drivers, a 15-min swap), and more than 9 h
 *   of driving in a day is pointed out. A break changes the arrival time only
 *   if the traveller ticks it. The figures are the professional drivers' norm
 *   (Order 340 / EU 561/2006), used here as a safety benchmark.
 * - Days are calendar days, from the start to the end of the trip.
 * - Transit times come from a timetable and are never moved; the curfew only
 *   adds warnings, because a train ticket works as a pass.
 */

/** Recommend a break after this much driving without a rest. */
export const BREAK_AFTER_MINUTES = 270;
export const BREAK_MINUTES = 45;
export const SWAP_MINUTES = 15;
/** More driving than this in one day is pointed out (one driver only). */
export const DAILY_DRIVING_MINUTES = 540;
/** A stop or pause at least this long counts as a rest. */
const REST_MINUTES = 45;
/** No point recommending a break this close to the end of the drive. */
const BREAK_NOT_IN_LAST_MINUTES = 20;

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
export type Note =
  | 'night-curfew'   // staying the night: the curfew comes before the next drive could end
  | 'night-limit'    // staying the night: the traveller's own "not after HH:MM"
  | 'wait-curfew'    // leaving later because of the curfew
  | 'wait-limit';    // leaving later because of the traveller's own hours

export interface ScheduledActivity {
  id: string;
  start: Date;
  end: Date;
  /** Did not fit before the night, so it was moved to the next morning. */
  moved: boolean;
}

export interface ScheduledBreak {
  /** 1 = the first break on this drive. Matches `Stop.takenBreaks`. */
  ordinal: number;
  /** When it is due: the moment the driving time reaches the limit. */
  at: Date;
  /** Kilometres from the start of the drive. */
  km: number;
  kind: 'rest' | 'swap';
  minutes: number;
  /** Ticked by the traveller, so it is in the arrival time. */
  taken: boolean;
}

export interface ScheduledStop {
  stopId: string;
  arrive: Date;
  /** Recommended breaks on the drive that leads here. */
  breaks: ScheduledBreak[];
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
  /** Everything spent on the road: driving, ticked breaks, timetable legs. */
  travelMinutes: number;
  /** Behind the wheel only. */
  drivingMinutes: number;
  activityMinutes: number;
  km: number;
  /** More than DAILY_DRIVING_MINUTES at the wheel, with one driver. */
  longDriving: boolean;
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

type SpanKind = 'drive' | 'break' | 'transit' | 'activity';
type Adder = (from: Date, to: Date, kind: SpanKind, km: number) => void;

/** The small hours: a stay that spans 03:00 is a night spent somewhere. */
const NIGHT_MARK = 3 * 60;

function nextNightMark(t: Date): Date {
  return clockMinutes(t) < NIGHT_MARK ? wallClock(t, NIGHT_MARK) : wallClock(t, NIGHT_MARK, 1);
}

const spansNight = (a: Date, b: Date): boolean => nextNightMark(a) < b;

const later = (a: Date, b: Date): Date => (a > b ? a : b);

const WHOLE_DAY: Intervals = [[0, 1440]];

interface DriveResult {
  end: Date;
  /** Had to stop on the road for the night (curfew or the traveller's limit). */
  split: boolean;
  breaks: ScheduledBreak[];
  /** Driving minutes since the last rest, carried into the next leg. */
  sinceRest: number;
}

/**
 * Drive for `minutes` from `from`, inside the allowed hours only, noting a
 * recommended break every BREAK_AFTER_MINUTES of driving.
 */
function drive(
  from: Date,
  minutes: number,
  iv: Allowed,
  km: number,
  add: Adder,
  opts: { sinceRest: number; drivers: 1 | 2; taken: ReadonlySet<number> },
): DriveResult {
  const breaks: ScheduledBreak[] = [];
  let sinceRest = opts.sinceRest;
  if (minutes <= 0) return { end: from, split: false, breaks, sinceRest };

  const kmPerMinute = km / minutes;
  const kind = opts.drivers === 2 ? 'swap' : 'rest';
  const breakLength = kind === 'swap' ? SWAP_MINUTES : BREAK_MINUTES;

  let t = from;
  let left = minutes;
  let split = false;
  let started = false;

  for (let guard = 0; left > 0 && guard < 1000; guard++) {
    const run = nextRun(t, iv);
    if (!run) {
      // Nothing is ever allowed (a curfew covering the whole day).
      const end = addMinutes(t, left);
      add(t, end, 'drive', kmPerMinute * left);
      return { end, split: true, breaks, sinceRest: sinceRest + left };
    }
    if (run.start > t) {
      if (started) split = true;
      if (minutesBetween(t, run.start) >= REST_MINUTES) sinceRest = 0;
    }
    started = true;

    // Drive until the run ends, the leg ends, or a break is due.
    const untilBreak = BREAK_AFTER_MINUTES - sinceRest;
    const room = minutesBetween(run.start, run.end);
    const used = Math.max(0, Math.min(left, room, untilBreak));
    const to = addMinutes(run.start, used);
    if (used > 0) add(run.start, to, 'drive', kmPerMinute * used);
    t = to;
    left -= used;
    sinceRest += used;

    if (sinceRest >= BREAK_AFTER_MINUTES) {
      sinceRest = 0;
      // A break that falls just as the road closes for the night is the night itself.
      const roadClosesNow = t >= run.end;
      if (left >= BREAK_NOT_IN_LAST_MINUTES && !roadClosesNow) {
        const ordinal = breaks.length + 1;
        const taken = opts.taken.has(ordinal);
        breaks.push({ ordinal, at: t, km: kmPerMinute * (minutes - left), kind, minutes: breakLength, taken });
        if (taken) {
          const back = addMinutes(t, breakLength);
          add(t, back, 'break', 0);
          t = back;
        }
      }
    }
  }
  return { end: t, split, breaks, sinceRest };
}

/** Find room for one activity of `minutes`, whole, at or after `t`. */
function place(
  t: Date, minutes: number, iv: Allowed,
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
  const morningMin = minutesOfDay(s.morning) ?? 5 * 60;
  const drivers = s.drivers === 2 ? 2 : 1;
  /** The traveller's own driving hours: from the morning until their limit, if they set one. */
  const roadWindow: Intervals = s.driveUntil ? daily(s.morning, s.driveUntil) : WHOLE_DAY;

  const curfews = trip.stops.map(resolveCurfew);
  const blocked = curfews.map(c => curfewIntervals(c.curfew));

  const start = parseLocal(trip.start) ?? new Date();
  // The start time is kept as set, even before the usual morning.
  const startMin = clockMinutes(start);
  const early: Intervals = startMin < morningMin ? [[startMin, morningMin]] : [];
  const withStartDay = (base: Intervals, cut: Intervals): Allowed => ({
    daily: subtract(base, cut),
    ...(early.length ? { except: { day: dayKey(start), iv: subtract(union(base, early), cut) } } : {}),
  });

  /** Driving between stops a and b: within the traveller's hours, outside both curfews. */
  const roadBetween = (a: number, b: number): Allowed =>
    withStartDay(roadWindow, [...blocked[a], ...blocked[b]]);

  const dayMap = new Map<string, DayTotals>();
  const dayOf = (key: string): DayTotals => {
    let day = dayMap.get(key);
    if (!day) {
      day = { key, travelMinutes: 0, drivingMinutes: 0, activityMinutes: 0, km: 0, longDriving: false };
      dayMap.set(key, day);
    }
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
      if (kind === 'activity') day.activityMinutes += chunk;
      else day.travelMinutes += chunk;
      if (kind === 'drive') day.drivingMinutes += chunk;
      day.km += km * (chunk / totalMinutes);
      cursor = chunkEnd;
    }
  };

  const out: ScheduledStop[] = [];
  /** When the traveller leaves the previous stop. */
  let clock = start;
  /** Driving minutes since the last real rest, across short stops. */
  let sinceRest = 0;

  trip.stops.forEach((stop, i) => {
    const warnings: Warning[] = [];
    const notes: Note[] = [];
    let breaks: ScheduledBreak[] = [];
    let arrive: Date;

    // ---- getting here ----
    if (i === 0) {
      arrive = clock;
    } else if (!stop.leg) {
      warnings.push('no-leg');
      arrive = clock;
    } else if (stop.leg.mode === 'transit') {
      sinceRest = 0;
      const dep = parseLocal(stop.leg.departAt);
      const arr = parseLocal(stop.leg.arriveAt);
      if (!dep || !arr) {
        warnings.push('bad-times');
        arrive = clock;
      } else {
        if (arr < dep) warnings.push('arrives-before-it-leaves');
        add(dep, arr, 'transit', 0);
        arrive = arr;
        if (covers(blocked[i], arr)) warnings.push('arrives-during-curfew');
      }
    } else {
      if (legIsUnknown(stop)) warnings.push('leg-unknown');
      const r = drive(clock, stop.leg.minutes, roadBetween(i - 1, i), stop.leg.km, add, {
        sinceRest, drivers, taken: new Set(stop.takenBreaks ?? []),
      });
      arrive = r.end;
      breaks = r.breaks;
      sinceRest = r.sinceRest;
      if (r.split) warnings.push('overnight-en-route');
    }

    // ---- what happens here ----
    const here = withStartDay(WHOLE_DAY, blocked[i]);
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
      earliest = later(earliest, later(mark, wallClock(mark, morningMin)));
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
      const curfewBoth = union(blocked[i], blocked[i + 1]);
      const run = nextRun(earliest, road);
      /** What stops today's driving early: the curfew, or the traveller's own limit. */
      let stoppedBy: 'curfew' | 'limit' = covers(curfewBoth, earliest) ? 'curfew' : 'limit';

      if (run) {
        depart = run.start;
        // Less than half of this drive fits before the road closes, and all of
        // it fits tomorrow: set off in the morning rather than spend the night
        // stuck halfway. With most of it fitting today, go — the card then
        // suggests a night stop near the end instead of losing a day.
        const leftToday = minutesBetween(run.start, run.end);
        if (leftToday < next.leg.minutes / 2) {
          const tomorrow = nextRun(run.end, road);
          if (tomorrow && minutesBetween(tomorrow.start, tomorrow.end) >= next.leg.minutes) {
            depart = tomorrow.start;
            stoppedBy = covers(curfewBoth, run.end) ? 'curfew' : 'limit';
          }
        }
      }
      if (depart > earliest) {
        if (spansNight(earliest, depart)) {
          if (!stop.overnight) notes.push(stoppedBy === 'curfew' ? 'night-curfew' : 'night-limit');
        } else {
          notes.push(stoppedBy === 'curfew' ? 'wait-curfew' : 'wait-limit');
        }
      }
    }

    // A stay long enough is a rest; the next drive starts fresh.
    if (minutesBetween(arrive, depart) >= REST_MINUTES) sinceRest = 0;

    clock = depart;
    out.push({
      stopId: stop.id, arrive, breaks, activities, activitiesEnd, depart, freeMinutes,
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
      const day = dayMap.get(key)
        ?? { key, travelMinutes: 0, drivingMinutes: 0, activityMinutes: 0, km: 0, longDriving: false };
      day.longDriving = drivers === 1 && day.drivingMinutes > DAILY_DRIVING_MINUTES;
      days.push(day);
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
