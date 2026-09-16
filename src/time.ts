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

/** 'HH:mm' -> minutes since midnight, or null when unparseable. */
export function minutesOfDay(s: string): number | null {
  const m = /^(\d\d?):(\d\d)$/.exec(s);
  return m ? +m[1] * 60 + +m[2] : null;
}

export const dayKey = (d: Date): string => isoLocal(d).slice(0, 10);

export const addMinutes = (d: Date, minutes: number): Date =>
  new Date(d.getTime() + minutes * 60000);

export const minutesBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 60000);

/** The same calendar day as `d`, at `minutes` past midnight. */
export function atMinutes(d: Date, minutes: number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return addMinutes(x, minutes);
}

/** The next calendar day, at `minutes` past midnight. */
export function nextDayAt(d: Date, minutes: number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 1);
  return addMinutes(x, minutes);
}

/** 90 -> '1h30', 45 -> '45m', 120 -> '2h'. The only place hours are formatted. */
export function formatMinutes(total: number | null): string {
  if (total == null) return '—';
  const sign = total < 0 ? '-' : '';
  const t = Math.abs(Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (!h) return `${sign}${m}m`;
  return m ? `${sign}${h}h${pad(m)}` : `${sign}${h}h`;
}

export const formatClock = (d: Date): string =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;
