import { readJson, writeJson } from '../lib/store';
import type { Point } from './nearestPlace';

export type PrivatePlace = { label: string; latitude: number; longitude: number; radiusKm: number };

const KEY = 'private-places';
const DEFAULT_RADIUS_KM = 25;

export function loadPrivatePlaces(): Promise<PrivatePlace[]> {
  return readJson<PrivatePlace[]>(KEY, []);
}

/** Adds a place only the phone knows about; a place with the same label is replaced. */
export async function addPrivatePlace(label: string, at: Point, radiusKm = DEFAULT_RADIUS_KM): Promise<void> {
  const others = (await loadPrivatePlaces()).filter((p) => p.label !== label);
  await writeJson(KEY, [...others, { label, latitude: at.latitude, longitude: at.longitude, radiusKm }]);
}

export async function removePrivatePlace(label: string): Promise<void> {
  await writeJson(KEY, (await loadPrivatePlaces()).filter((p) => p.label !== label));
}
