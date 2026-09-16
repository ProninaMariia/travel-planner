/** Place search and road distances. Both services are public and need no key. */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
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

export interface RoadLeg { km: number; minutes: number }

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
): Promise<RoadLeg> {
  const url = `${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=false&alternatives=false&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`router HTTP ${res.status}`);
  const data = await res.json() as { code: string; routes?: Array<{ distance: number; duration: number }> };
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.code || 'no route');
  return {
    km: data.routes[0].distance / 1000,
    minutes: Math.round(data.routes[0].duration / 60),
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
