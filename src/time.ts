/** Local-time helpers. Everything in the model is local wall-clock, never UTC. */

const pad = (n: number) => String(n).padStart(2, '0');

export function parseLocal(s: string): Date | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'HH:mm' -> minutes since midnight (0..1440), or null when unparseable. */
export function minutesOfDay(s: string): number | null {
  const m = /^(\d\d?):(\d\d)$/.exec(s);
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return v >= 0 && v <= 1440 && +m[2] < 60 ? v : null;
}

/** Minutes past local midnight shown on the wall clock at `d`. */
export const clockMinutes = (d: Date): number => d.getHours() * 60 + d.getMinutes();

export const dayKey = (d: Date): string => isoLocal(d).slice(0, 10);

export const addMinutes = (d: Date, minutes: number): Date =>
  new Date(d.getTime() + minutes * 60000);

export const minutesBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 60000);

/**
 * The calendar day of `d` shifted by `days`, with the wall clock at `minutes`.
 * Built from calendar fields, never by adding milliseconds to midnight, so a
 * day with a clock change (25 or 23 hours long) still ends at the right hour.
 * `minutes` may be 1440, which is midnight at the start of the following day.
 */
export function wallClock(d: Date, minutes: number, days = 0): Date {
  return new Date(
    d.getFullYear(), d.getMonth(), d.getDate() + days,
    Math.floor(minutes / 60), minutes % 60, 0, 0,
  );
}

/** The same calendar day as `d`, at `minutes` past midnight. */
export const atMinutes = (d: Date, minutes: number): Date => wallClock(d, minutes);

/** The next calendar day, at `minutes` past midnight. */
export const nextDayAt = (d: Date, minutes: number): Date => wallClock(d, minutes, 1);

/** 90 -> '1 год 30 хв', 45 -> '45 хв', 120 -> '2 год'. The only place durations are formatted. */
export function formatMinutes(total: number | null): string {
  if (total == null) return '—';
  const sign = total < 0 ? '−' : '';
  const t = Math.abs(Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (!h) return `${sign}${m} хв`;
  return m ? `${sign}${h} год ${m} хв` : `${sign}${h} год`;
}

export const formatClock = (d: Date): string =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;
