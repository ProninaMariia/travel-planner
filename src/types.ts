/** How the traveller moves between stops. Chosen once, first thing. */
export type TripMode = 'car' | 'transit';

export type TransitKind = 'train' | 'bus' | 'flight';

/** Where a car leg's numbers came from, so the UI can say so. */
export type LegSource = 'road' | 'estimate' | 'manual';

export interface Activity {
  id: string;
  title: string;
  /** Minutes. Never decimal hours — formatting is a display concern. */
  minutes: number;
}

/** Arrival is computed unless the traveller pinned it. */
export type Arrival =
  | { kind: 'auto' }
  | { kind: 'pinned'; at: string };

/**
 * Two different shapes, picked by `mode` — not one shape with optional fields.
 * A transit leg has no `km` at all, so it cannot be shown by accident.
 */
export type Leg =
  | { mode: 'car'; source: LegSource; km: number; minutes: number }
  | {
      mode: 'transit';
      kind: TransitKind;
      /** Local time, 'YYYY-MM-DDTHH:mm'. From a timetable. */
      departAt: string;
      arriveAt: string;
      note?: string;
    };

export interface Stop {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  label: string;
  arrival: Arrival;
  overnight: boolean;
  activities: Activity[];
  /** How we got HERE from the previous stop. null on the first stop. */
  leg: Leg | null;
}

export interface Settings {
  /** 'HH:mm' — the hours the traveller is willing to be on the road. */
  dayStart: string;
  dayEnd: string;
  avgSpeedKmh: number;
  roadFactor: number;
  /** Added once per stop that has any activities. */
  stopBufferMinutes: number;
}

export interface Trip {
  version: 2;
  title: string;
  mode: TripMode;
  /** When the traveller is at the first stop, ready to begin. */
  start: string;
  settings: Settings;
  stops: Stop[];
  /** Parked "maybe, if there's time" stops. Never counted. */
  parked: Stop[];
}
