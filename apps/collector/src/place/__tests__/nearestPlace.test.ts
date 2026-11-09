import { nearestPlace, kmBetween, type City } from '../nearestPlace';

const TABLE: City[] = [
  ['Lisbon', 3872, -914, 518, 'PT', 'Lisbon'],
  ['Porto', 4115, -861, 250, 'PT', 'Porto'],
  ['London', 5151, -13, 8962, 'GB', 'England'],
  ['Islington', 5154, -10, 319, 'GB', 'England'],
];

describe('nearestPlace', () => {
  it('a borough reads as its metro city, with region and country name', () => {
    expect(nearestPlace({ latitude: 51.538, longitude: -0.103 }, TABLE)).toEqual({
      city: 'London', region: 'England', countryCode: 'GB', country: 'United Kingdom',
    });
  });

  it('names Lisbon', () => {
    expect(nearestPlace({ latitude: 38.72, longitude: -9.14 }, TABLE)).toMatchObject({ city: 'Lisbon', countryCode: 'PT' });
  });

  it('names nothing more than 40 km from every city', () => {
    expect(nearestPlace({ latitude: 39.4, longitude: -8.9 }, TABLE)).toBeNull();
  });

  it('nearest wins when no city is within the 25 km metro radius', () => {
    // 0.3 degrees of latitude is about 33 km from Porto.
    expect(nearestPlace({ latitude: 41.45, longitude: -8.61 }, TABLE)?.city).toBe('Porto');
  });

  it('the 40 km limit: just inside names the city, just outside names nothing', () => {
    expect(nearestPlace({ latitude: 41.15 + 39.5 / 111.32, longitude: -8.61 }, TABLE)?.city).toBe('Porto');
    expect(nearestPlace({ latitude: 41.15 + 40.5 / 111.32, longitude: -8.61 }, TABLE)).toBeNull();
  });

  it('ignores a fix that is not a place on Earth', () => {
    expect(nearestPlace({ latitude: Number.NaN, longitude: 0 }, TABLE)).toBeNull();
    expect(nearestPlace({ latitude: 91, longitude: 0 }, TABLE)).toBeNull();
    expect(nearestPlace({ latitude: 0, longitude: 181 }, TABLE)).toBeNull();
  });

  it('returns exactly city, region, countryCode, country', () => {
    const found = nearestPlace({ latitude: 38.72, longitude: -9.14 }, TABLE)!;
    expect(Object.keys(found).sort()).toEqual(['city', 'country', 'countryCode', 'region']);
  });

  it('measures kilometres between points', () => {
    expect(kmBetween({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.32, 1);
  });
});

describe('bundled table', () => {
  it('finds London from Islington', () => {
    expect(nearestPlace({ latitude: 51.538, longitude: -0.103 })).toEqual({
      city: 'London', region: 'England', countryCode: 'GB', country: 'United Kingdom',
    });
  });

  it('finds Lisbon in Portugal', () => {
    expect(nearestPlace({ latitude: 38.72, longitude: -9.14 })).toMatchObject({ city: 'Lisbon', countryCode: 'PT', country: 'Portugal' });
  });
});

describe('bundled names', () => {
  const trimmed = (name: string) => name === name.trim() && name !== '';

  it('have no leading or trailing whitespace, since the site matches country names exactly', () => {
    const countries = require('../countries.json') as Record<string, string>;
    const cities = require('../cities.json') as { regions: string[]; rows: [string, ...unknown[]][] };
    expect(Object.values(countries).filter((n) => !trimmed(n))).toEqual([]);
    expect(cities.regions.filter((n) => n !== n.trim())).toEqual([]);
    expect(cities.rows.map((r) => r[0]).filter((n) => !trimmed(n))).toEqual([]);
  });
});
