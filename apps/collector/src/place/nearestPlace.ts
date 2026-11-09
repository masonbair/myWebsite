/** [GeoNames id, name, latitude × 100, longitude × 100, population in thousands, country code, region], as `scripts/build-cities.ts` writes them. */
export type City = readonly [
  id: number, name: string, lat100: number, lng100: number, thousands: number, countryCode: string, region: string,
];
export type Point = { latitude: number; longitude: number };
/** region is '' when GeoNames has no first-level division: the database column is NOT NULL default ''. */
export type FoundPlace = { city: string; region: string; countryCode: string; country: string };

/** GeoNames data is CC BY 4.0. */
export const ABOUT = 'Place names from GeoNames (geonames.org), licensed CC BY 4.0.';

const MAX_KM = 40;
// Within this, the biggest place wins, so a borough or suburb reads as its city (Islington is London).
const METRO_KM = 25;
const KM_PER_DEGREE = 111.32;

let cities: City[] | null = null;
let countries: Record<string, string> | null = null;

// Loaded on first use so the ~500 KB table is not parsed at app start.
function loadCities(): City[] {
  cities ??= require('./cities.json') as City[];
  return cities;
}

function loadCountries(): Record<string, string> {
  countries ??= require('./countries.json') as Record<string, string>;
  return countries;
}

/** Kilometres between two points, flat-earth: exact enough at city scale. */
export function kmBetween(a: Point, b: Point): number {
  const dLat = (b.latitude - a.latitude) * KM_PER_DEGREE;
  let dLngDeg = Math.abs(b.longitude - a.longitude);
  if (dLngDeg > 180) dLngDeg = 360 - dLngDeg;
  const dLng = dLngDeg * KM_PER_DEGREE * Math.cos((a.latitude * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** The closest bundled city within 40 km of a rough fix; the fix itself never leaves this function. */
export function nearestPlace(fix: Point, table?: readonly City[]): FoundPlace | null {
  const { latitude, longitude } = fix;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  let nearest: City | null = null;
  let nearestKm = MAX_KM;
  let biggest: City | null = null;
  for (const city of table ?? loadCities()) {
    const km = kmBetween(fix, { latitude: city[2] / 100, longitude: city[3] / 100 });
    if (km <= nearestKm) {
      nearest = city;
      nearestKm = km;
    }
    if (km <= METRO_KM && (!biggest || city[4] > biggest[4])) biggest = city;
  }
  const best = biggest ?? nearest;
  if (!best) return null;
  const countryCode = best[5];
  return { city: best[1], region: best[6], countryCode, country: loadCountries()[countryCode] ?? countryCode };
}
