// GeoNames data is CC BY 4.0. Needs Node 22.6+ (type stripping) and `unzip`.
// Usage: node --experimental-strip-types scripts/build-cities.ts <download-dir>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const BASE = 'https://download.geonames.org/export/dump/';
const OUT_DIR = resolve(import.meta.dirname, '../src/place');

async function fetchOnce(dir: string, file: string) {
  if (existsSync(join(dir, file))) return;
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`download of ${file} failed: ${res.status}`);
  writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()));
}

const lines = (path: string) => readFileSync(path, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('pass a download directory outside the repo');
  mkdirSync(dir, { recursive: true });
  for (const f of ['cities15000.zip', 'admin1CodesASCII.txt', 'countryInfo.txt']) await fetchOnce(dir, f);
  execFileSync('unzip', ['-oq', join(dir, 'cities15000.zip'), '-d', dir]);

  const regions = new Map<string, string>();
  for (const line of lines(join(dir, 'admin1CodesASCII.txt'))) {
    const [code, , ascii] = line.split('\t');
    regions.set(code, ascii);
  }

  const countries: Record<string, string> = {};
  for (const line of lines(join(dir, 'countryInfo.txt'))) {
    const c = line.split('\t');
    countries[c[0]] = c[4];
  }

  const rows = lines(join(dir, 'cities15000.txt'))
    .map((line) => line.split('\t'))
    // PPLX is a section of a city (a district), never what a check-in should name.
    .filter((c) => c.length > 14 && c[7].startsWith('PPL') && c[7] !== 'PPLX')
    .map((c) => ({
      name: c[1], lat100: Math.round(Number(c[4]) * 100), lng100: Math.round(Number(c[5]) * 100),
      thousands: Math.round(Number(c[14]) / 1000), cc: c[8], region: regions.get(`${c[8]}.${c[10]}`) ?? '', id: Number(c[0]),
    }))
    .sort((a, b) => a.id - b.id);

  const regionNames = [...new Set(rows.map((r) => r.region))].sort();
  const regionIndex = new Map(regionNames.map((r, i) => [r, i]));
  const unknown = rows.filter((r) => !countries[r.cc]);
  if (unknown.length) throw new Error(`${unknown.length} cities have a country code missing from countryInfo`);

  // Regions are interned: the same few thousand names repeat across ~25k rows.
  const json = JSON.stringify({
    regions: regionNames,
    rows: rows.map((r) => [r.name, r.lat100, r.lng100, r.thousands, r.cc, regionIndex.get(r.region)]),
  });
  writeFileSync(join(OUT_DIR, 'cities.json'), json);
  writeFileSync(join(OUT_DIR, 'countries.json'), JSON.stringify(countries));
  console.log(`${rows.length} cities, ${regionNames.length} regions, ${Math.round(json.length / 1024)} KB, ${Math.round(gzipSync(json).length / 1024)} KB gzipped`);
}

main().catch((e) => { console.error(e); process.exit(1); });
