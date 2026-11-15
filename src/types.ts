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

/** Curfew hours, local wall clock 'HH:mm'. `start` > `end` means it runs past midnight. */
export interface Curfew {
  start: string;
  end: string;
}

/**
 * The traveller's own correction to the curfew table, which goes out of date
 * and cannot know every community's exception.
 */
export type CurfewOverride =
  | { kind: 'none' }
  | { kind: 'hours'; start: string; end: string };

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
  /**
   * The traveller typed this name themselves, so the map must not overwrite it
   * when the pin moves. Absent on stops that still carry the geocoder's name.
   */
  renamed?: boolean;
  lat: number | null;
  lon: number | null;
  label: string;
  /**
   * The region the stop is in, as an ISO 3166-2 code ('UA-46' is Lviv oblast),
   * which is what the curfew table is keyed by. Absent until the geocoder says.
   */
  region?: string;
  curfewOverride?: CurfewOverride;
  /** The traveller wants to stay the night here, even if they could drive on. */
  overnight: boolean;
  activities: Activity[];
  /** How we got HERE from the previous stop. null on the first stop. */
  leg: Leg | null;
}

export interface Settings {
  /**
   * 'HH:mm'. The traveller's day: nothing is planned before `dayStart`, and
   * driving stops at `dayEnd`. Activities may run into the evening — only the
   * curfew ends them.
   */
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
