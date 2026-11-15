import type { Curfew, Stop } from './types.ts';

/**
 * Curfew hours by region, keyed by ISO 3166-2 code — Nominatim returns it in
 * every answer as `ISO3166-2-lvl4`, whatever language the names come back in.
 *
 * There is no official feed for this: each regional military administration
 * sets its own hours and changes them. So the table carries the date it was
 * checked, the app says so on screen, and every stop can be corrected by hand.
 *
 * Sources (oblast centres): slovoidilo.ua 08.09.2026 and 11.09.2026,
 * The Page 09.2026 (Kyiv), Kyiv Post 11.2026 (Donetsk oblast).
 */
export const CURFEW_CHECKED = '2026-11-15';

/** Most of the country, and the answer when the region is not known. */
export const DEFAULT_CURFEW: Curfew = { start: '00:00', end: '05:00' };

interface Region {
  name: string;
  /** null — no curfew in this region. */
  curfew: Curfew | null;
}

const h = (start: string, end: string): Curfew => ({ start, end });

export const REGIONS: Record<string, Region> = {
  'UA-05': { name: 'Вінницька обл.', curfew: h('00:00', '05:00') },
  'UA-07': { name: 'Волинська обл.', curfew: h('00:00', '05:00') },
  'UA-09': { name: 'Луганська обл.', curfew: h('00:00', '05:00') },
  'UA-12': { name: 'Дніпропетровська обл.', curfew: h('00:00', '05:00') },
  // Except the Oleksandrivka and Cherkaske communities. Since 01.11.2026.
  'UA-14': { name: 'Донецька обл.', curfew: h('16:00', '11:00') },
  'UA-18': { name: 'Житомирська обл.', curfew: h('00:00', '05:00') },
  'UA-21': { name: 'Закарпатська обл.', curfew: null },
  'UA-23': { name: 'Запорізька обл.', curfew: h('00:00', '05:00') },
  'UA-26': { name: 'Івано-Франківська обл.', curfew: h('00:00', '05:00') },
  'UA-30': { name: 'Київ', curfew: h('01:00', '05:00') },
  'UA-32': { name: 'Київська обл.', curfew: h('00:00', '05:00') },
  'UA-35': { name: 'Кіровоградська обл.', curfew: h('01:00', '05:00') },
  'UA-46': { name: 'Львівська обл.', curfew: h('00:00', '05:00') },
  // Ochakiv and some coastal communities: 22:00–06:00.
  'UA-48': { name: 'Миколаївська обл.', curfew: h('00:00', '05:00') },
  'UA-51': { name: 'Одеська обл.', curfew: h('00:00', '05:00') },
  'UA-53': { name: 'Полтавська обл.', curfew: h('01:00', '05:00') },
  'UA-56': { name: 'Рівненська обл.', curfew: h('00:00', '05:00') },
  'UA-59': { name: 'Сумська обл.', curfew: h('00:00', '05:00') },
  'UA-61': { name: 'Тернопільська обл.', curfew: h('00:00', '05:00') },
  'UA-63': { name: 'Харківська обл.', curfew: h('00:00', '05:00') },
  'UA-65': { name: 'Херсонська обл.', curfew: h('21:00', '05:00') },
  'UA-68': { name: 'Хмельницька обл.', curfew: h('00:00', '05:00') },
  'UA-71': { name: 'Черкаська обл.', curfew: h('00:00', '04:00') },
  'UA-73': { name: 'Чернігівська обл.', curfew: h('00:00', '04:00') },
  'UA-77': { name: 'Чернівецька обл.', curfew: h('01:00', '04:00') },
};

export interface ResolvedCurfew {
  curfew: Curfew | null;
  /** Where the hours came from, so the card can say so. */
  source: 'override' | 'table' | 'default' | 'abroad';
  regionName: string | null;
}

export function resolveCurfew(stop: Pick<Stop, 'region' | 'curfewOverride'>): ResolvedCurfew {
  const region = stop.region ? REGIONS[stop.region] : undefined;
  const regionName = region?.name ?? null;

  const o = stop.curfewOverride;
  if (o) {
    return { curfew: o.kind === 'none' ? null : { start: o.start, end: o.end }, source: 'override', regionName };
  }
  if (region) return { curfew: region.curfew, source: 'table', regionName };
  // A known region outside Ukraine: no curfew to plan around.
  if (stop.region && !stop.region.startsWith('UA-')) return { curfew: null, source: 'abroad', regionName };
  return { curfew: DEFAULT_CURFEW, source: 'default', regionName };
}

export const formatCurfew = (c: Curfew | null): string =>
  c ? `${c.start}–${c.end}` : 'немає';
