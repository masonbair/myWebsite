import { readJson, writeJson } from '../lib/store';
import type { Point } from './nearestPlace';

export type PrivatePlace = { label: string; latitude: number; longitude: number; radiusKm: number };

const KEY = 'private-places';
const DEFAULT_RADIUS_KM = 25;

function isValid(p: unknown): p is PrivatePlace {
  if (typeof p !== 'object' || p === null) return false;
  const { label, latitude, longitude, radiusKm } = p as Record<string, unknown>;
  return (
    typeof label === 'string' && label !== '' &&
    typeof latitude === 'number' && Number.isFinite(latitude) &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    typeof radiusKm === 'number' && Number.isFinite(radiusKm) && radiusKm > 0
  );
}

/** Stored JSON is not trusted: malformed entries are dropped. */
export async function loadPrivatePlaces(): Promise<PrivatePlace[]> {
  const stored = await readJson<unknown>(KEY, []);
  return Array.isArray(stored) ? stored.filter(isValid) : [];
}

/** Adds a place only the phone knows about; a place with the same label is replaced. */
export async function addPrivatePlace(label: string, at: Point, radiusKm = DEFAULT_RADIUS_KM): Promise<void> {
  const others = (await loadPrivatePlaces()).filter((p) => p.label !== label);
  await writeJson(KEY, [...others, { label, latitude: at.latitude, longitude: at.longitude, radiusKm }]);
}

export async function removePrivatePlace(label: string): Promise<void> {
  await writeJson(KEY, (await loadPrivatePlaces()).filter((p) => p.label !== label));
}
