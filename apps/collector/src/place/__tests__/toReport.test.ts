import type { PlaceRow } from '../../../../../shared/collector-contract';
import { nearestPlace, type City, type Point } from '../nearestPlace';
import type { PrivatePlace } from '../privatePlaces';
import { toPlaceRow, toReport, type PlaceReport } from '../toReport';

const TABLE: City[] = [
  ['Paris', 4885, 235, 2138, 'FR', 'Ile-de-France'],
  ['Reykjavik', 6415, -2194, 120, 'IS', ''],
];
const lookup = (fix: Point) => nearestPlace(fix, TABLE);

const PARIS_CENTER: Point = { latitude: 48.85, longitude: 2.35 };
const at = (km: number): Point => ({ latitude: PARIS_CENTER.latitude + km / 111.32, longitude: PARIS_CENTER.longitude });
const place = (radiusKm = 25): PrivatePlace => ({ label: 'test-a', ...PARIS_CENTER, radiusKm });

describe('toReport', () => {
  it('reports the city outside any private place', () => {
    expect(toReport(at(1), [], lookup)).toEqual({
      city: 'Paris', region: 'Ile-de-France', countryCode: 'FR', country: 'France', private: false,
    });
  });

  it('hides the city inside a private place but keeps region and country', () => {
    const fix = at(3);
    expect(toReport(fix, [place()], lookup)).toEqual({
      city: null, region: 'Ile-de-France', countryCode: 'FR', country: 'France', private: true,
    });
  });

  it('reports the city once the fix is outside the radius', () => {
    const report = toReport(at(30), [place(25)], lookup);
    expect(report).toMatchObject({ city: 'Paris', private: false });
  });

  it('honours a small radius', () => {
    expect(toReport(at(3), [place(2)], lookup)).toMatchObject({ private: false });
    expect(toReport(at(3), [place(5)], lookup)).toMatchObject({ private: true });
  });

  it('is private when any one of several places contains the fix', () => {
    const far: PrivatePlace = { label: 'test-b', latitude: 35.68, longitude: 139.69, radiusKm: 25 };
    expect(toReport(at(1), [far, place()], lookup)).toMatchObject({ private: true });
  });

  it('passes the region through as an empty string when there is none', () => {
    const report = toReport({ latitude: 64.15, longitude: -21.94 }, [], lookup);
    expect(report).toMatchObject({ city: 'Reykjavik', region: '', countryCode: 'IS' });
  });

  it('returns null when the lookup finds nothing', () => {
    expect(toReport({ latitude: 0, longitude: -30 }, [], lookup)).toBeNull();
  });

  it('returns null inside a private place when the lookup finds nothing', () => {
    const mid: Point = { latitude: 0, longitude: -30 };
    const p: PrivatePlace = { label: 'test-a', ...mid, radiusKm: 25 };
    expect(toReport(mid, [p], lookup)).toBeNull();
  });

  it('checks private places before the lookup', () => {
    const order: string[] = [];
    const spyPlace = { get latitude() { order.push('private'); return PARIS_CENTER.latitude; }, longitude: PARIS_CENTER.longitude, label: 'test-a', radiusKm: 25 };
    toReport(at(1), [spyPlace], (fix) => { order.push('lookup'); return lookup(fix); });
    expect(order[0]).toBe('private');
    expect(order).toContain('lookup');
  });

  it('uses the bundled table by default', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    expect(toReport(london, [])).toMatchObject({ city: 'London', countryCode: 'GB', private: false });
  });

  it('carries nothing coordinate-like', () => {
    const fix = { latitude: 48.8421, longitude: 2.3587 };
    for (const privatePlaces of [[], [place()]]) {
      const json = JSON.stringify(toReport(fix, privatePlaces, lookup));
      expect(json).not.toMatch(/latitude|longitude/i);
      expect(json).not.toContain('48.84');
      expect(json).not.toContain('2.358');
      expect(json).not.toContain('test-a');
    }
  });
});

describe('toPlaceRow', () => {
  const report: PlaceReport = { city: 'Paris', region: 'Ile-de-France', countryCode: 'FR', country: 'France', private: false };
  const ROW_KEYS: (keyof PlaceRow)[] = ['city', 'country', 'private', 'region', 'time_zone'];

  it('maps a public report', () => {
    expect(toPlaceRow(report, 'Europe/Paris')).toEqual({
      city: 'Paris', region: 'Ile-de-France', country: 'France', private: false, time_zone: 'Europe/Paris',
    });
  });

  it('maps a private report with a null city', () => {
    expect(toPlaceRow({ ...report, city: null, private: true }, null)).toEqual({
      city: null, region: 'Ile-de-France', country: 'France', private: true, time_zone: null,
    });
  });

  it('has exactly the PlaceRow keys and no country code', () => {
    const row = toPlaceRow(report, 'Europe/Paris');
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(JSON.stringify(row)).not.toMatch(/latitude|longitude|lat|lng|countryCode/i);
    expect(Object.values(row)).not.toContain('FR');
  });
});
