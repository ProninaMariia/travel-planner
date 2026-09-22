/** Place search and road distances. Both services are public and need no key. */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

export interface Place {
  name: string;
  label: string;
  lat: number;
  lon: number;
}

/**
 * `acceptLanguage` matters: without it Nominatim answers in the local language,
 * so an English query can come back unrecognisable. Testers hit exactly this.
 */
export async function searchPlaces(query: string, acceptLanguage = 'uk,en'): Promise<Place[]> {
  const url = `${NOMINATIM}?format=jsonv2&limit=6&accept-language=${encodeURIComponent(acceptLanguage)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return rows.map(r => ({
    name: r.display_name.split(',')[0].trim(),
    label: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
  }));
}

/**
 * What is at this point?
 *
 * Nominatim answers with whatever object covers the coordinates, and in the
 * countryside that is an administrative unit — "Судилківська сільська
 * громада" — which is technically right and useless to a traveller. So we
 * read the address instead and take the most settlement-like part of it:
 * a city first, then a town, then a village. The administrative unit is a
 * last resort, not a first answer.
 */
const SETTLEMENT_KEYS = [
  'city', 'town', 'village', 'hamlet', 'borough', 'suburb',
  'municipality', 'county', 'state',
] as const;

interface ReverseAnswer {
  display_name?: string;
  name?: string;
  address?: Record<string, string>;
}

function settlementName(row: ReverseAnswer): string | null {
  const address = row.address ?? {};
  for (const key of SETTLEMENT_KEYS) {
    const value = address[key];
    if (value) return value;
  }
  return row.name?.trim() || row.display_name?.split(',')[0].trim() || null;
}

export async function reverseGeocode(
  lat: number, lon: number, acceptLanguage = 'uk,en',
): Promise<Place | null> {
  const url = `${NOMINATIM_REVERSE}?format=jsonv2&zoom=12&addressdetails=1`
    + `&accept-language=${encodeURIComponent(acceptLanguage)}`
    + `&lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const row = (await res.json()) as ReverseAnswer;
    const name = settlementName(row);
    if (!name) return null;
    return { name, label: row.display_name ?? name, lat, lon };
  } catch {
    return null;
  }
}

export interface RoadLeg { km: number; minutes: number }

/** [lat, lon] pairs along the road, for drawing. Never stored in the trip. */
export type Shape = Array<[number, number]>;

/** Straight line across the globe, in kilometres. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function roadLeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): Promise<RoadLeg & { shape: Shape }> {
  // `overview=simplified` returns the road's shape with far fewer points than
  // the full geometry — enough to draw, small enough not to slow the map down.
  const url = `${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}`
    + '?overview=simplified&geometries=geojson&alternatives=false&steps=false';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`router HTTP ${res.status}`);
  const data = await res.json() as {
    code: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry?: { coordinates: Array<[number, number]> };
    }>;
  };
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.code || 'no route');
  const route = data.routes[0];
  return {
    km: route.distance / 1000,
    minutes: Math.round(route.duration / 60),
    // GeoJSON is [lon, lat]; every map library here wants [lat, lon].
    shape: (route.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number]),
  };
}

/** Used when there is no route service or no coordinates. */
export function estimateLeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  roadFactor: number,
  avgSpeedKmh: number,
): RoadLeg {
  const km = haversineKm(a, b) * roadFactor;
  return { km, minutes: Math.round((km / avgSpeedKmh) * 60) };
}
