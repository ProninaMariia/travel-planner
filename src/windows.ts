/**
 * When something is allowed to happen, as the same set of clock intervals every
 * day — "from 09:00 to 20:00, except the curfew" — and how to walk real time
 * through them.
 *
 * Intervals are minutes past midnight, [start, end), sorted and disjoint,
 * inside 0..1440. Real moments are always rebuilt from the wall clock, so a day
 * with a clock change still opens and closes at the hours it says.
 */
import type { Curfew } from './types.ts';
import { minutesOfDay, clockMinutes, wallClock, dayKey } from './time.ts';

export type Intervals = Array<[number, number]>;

const WHOLE_DAY: Intervals = [[0, 1440]];

/** 'from'..'to' on every day. An unusable pair means no limit at all. */
export function daily(from: string, to: string): Intervals {
  const a = minutesOfDay(from);
  const b = minutesOfDay(to);
  if (a == null || b == null || b <= a) return WHOLE_DAY;
  return [[a, b]];
}

/** The part of the day a curfew covers. One that runs past midnight is two pieces. */
export function curfewIntervals(c: Curfew | null): Intervals {
  if (!c) return [];
  const a = minutesOfDay(c.start);
  const b = minutesOfDay(c.end);
  if (a == null || b == null || a === b) return [];
  return a < b ? [[a, b]] : [[0, b], [a, 1440]];
}

/** `base` with every piece of `cut` taken out. */
export function subtract(base: Intervals, cut: Intervals): Intervals {
  let out = base;
  for (const [ca, cb] of cut) {
    const next: Intervals = [];
    for (const [a, b] of out) {
      if (cb <= a || ca >= b) { next.push([a, b]); continue; }
      if (ca > a) next.push([a, ca]);
      if (cb < b) next.push([cb, b]);
    }
    out = next;
  }
  return out;
}

/** Everything in `a` or `b`, as sorted, disjoint intervals. */
export function union(a: Intervals, b: Intervals): Intervals {
  const all = [...a, ...b].sort((x, y) => x[0] - y[0]);
  const out: Intervals = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Allowed hours: the same every day, except on one calendar day that may
 * differ — the day the trip starts, when the traveller's own start time
 * counts even if it is earlier than their usual day.
 */
export interface Allowed {
  daily: Intervals;
  except?: { day: string; iv: Intervals };
}

/** Is the wall clock at `t` inside one of the intervals? */
export function covers(iv: Intervals, t: Date): boolean {
  const m = clockMinutes(t);
  return iv.some(([a, b]) => m >= a && m < b);
}

export interface Run {
  /** The first allowed moment at or after the asked time. */
  start: Date;
  /** Where that stretch of allowed time ends — possibly days later. */
  end: Date;
}

/** How far ahead to look before deciding nothing is ever allowed. */
const HORIZON_DAYS = 60;

/**
 * The first allowed stretch of time at or after `t`. A stretch that reaches
 * midnight and picks up again at 00:00 is one stretch, not two: driving on
 * through midnight is not a pause.
 */
export function nextRun(t: Date, allowed: Intervals | Allowed): Run | null {
  const a: Allowed = Array.isArray(allowed) ? { daily: allowed } : allowed;
  const listFor = (day: number): Intervals =>
    a.except && dayKey(wallClock(t, 0, day)) === a.except.day ? a.except.iv : a.daily;

  const whole = (iv: Intervals) => iv.length === 1 && iv[0][0] === 0 && iv[0][1] === 1440;
  if (!a.except && whole(a.daily)) return { start: t, end: wallClock(t, 0, HORIZON_DAYS) };

  for (let day = 0; day <= HORIZON_DAYS; day++) {
    for (const [from, to] of listFor(day)) {
      let end = wallClock(t, to, day);
      if (end <= t) continue;
      const start = new Date(Math.max(wallClock(t, from, day).getTime(), t.getTime()));

      // Allowed until midnight and again from 00:00: one stretch, not two.
      let reach = to;
      for (let d = day + 1; reach === 1440 && d - day <= HORIZON_DAYS; d++) {
        const next = listFor(d);
        if (!next.length || next[0][0] !== 0) break;
        reach = next[0][1];
        end = wallClock(t, reach, d);
      }
      return { start, end };
    }
  }
  return null;
}
