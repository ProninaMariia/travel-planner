import type { Trip, Stop, TripMode } from './types.ts';

const KEY = 'travel-planner-v2';

export const uid = (): string => Math.random().toString(36).slice(2, 9);

export function newStop(
  name: string, lat: number | null = null, lon: number | null = null, label = '', region?: string,
): Stop {
  return {
    id: uid(), name, lat, lon, label,
    ...(region ? { region } : {}),
    overnight: false, activities: [], leg: null,
  };
}

/**
 * Trips saved before this version carry an `arrival` field that no longer
 * exists. Drop it rather than refuse the whole trip.
 */
function upgradeStop(raw: Stop & { arrival?: unknown }): Stop {
  const { arrival: _dropped, ...stop } = raw;
  void _dropped;
  return stop;
}

export function blankTrip(mode: TripMode): Trip {
  const tomorrow = new Date(Date.now() + 864e5);
  const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  return {
    version: 2,
    title: '',
    mode,
    start: `${iso}T09:00`,
    settings: {
      dayStart: '09:00', dayEnd: '20:00',
      avgSpeedKmh: 70, roadFactor: 1.25, stopBufferMinutes: 0,
    },
    stops: [],
    parked: [],
  };
}

export function loadTrip(): Trip | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Trip;
    if (!data || data.version !== 2) return null;
    return {
      ...data,
      stops: (data.stops ?? []).map(upgradeStop),
      parked: (data.parked ?? []).map(upgradeStop),
    };
  } catch {
    return null;
  }
}

export function saveTrip(trip: Trip): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(trip));
  } catch {
    /* private mode, quota — the trip still works for this session */
  }
}

export function clearTrip(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
