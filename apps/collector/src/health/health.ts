import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import { isIgnoringBatteryOptimizations, standbyBucket } from '../../modules/battery-status';
import { readJson } from '../lib/store';
import { signedIn } from '../lib/supabase';

export type JobName = 'place' | 'photos' | 'daylio';

export type HealthInput = {
  signedIn: boolean;
  backgroundLocation: 'granted' | 'denied' | 'undetermined';
  photosAccess: 'all' | 'limited' | 'none';
  daylioFolder: boolean;
  batteryUnrestricted: boolean;
  standbyBucket: number;
  lastOk: Record<JobName, number | null>;
  now: number;
};

export type HealthFix =
  | 'app-settings'
  | 'battery-optimization'
  | 'pick-folder'
  | 'sign-in'
  | 'grant-location'
  | 'grant-photos';

export type HealthItem = { key: string; ok: boolean; label: string; fix: HealthFix | null };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Android buckets: 45 is restricted, 50 is never. 0 means the phone could not say.
const RESTRICTED_BUCKET = 45;
const PHOTOS_STALE_MS = 3 * HOUR;
const DAYLIO_STALE_MS = 3 * HOUR;
// Location only reports on movement plus every 6 hours, so a day of silence means it stopped.
const PLACE_STALE_MS = 24 * HOUR;

const JOB_KEYS = { place: 'job-last-ok:place', photos: 'job-last-ok:photos', daylio: 'job-last-ok:daylio' } as const;
const FOLDER_KEY = 'daylio-folder-uri';

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function ago(ms: number): string {
  if (ms < HOUR) return `${plural(Math.max(1, Math.floor(ms / MINUTE)), 'minute')} ago`;
  if (ms < 48 * HOUR) return `${plural(Math.floor(ms / HOUR), 'hour')} ago`;
  return `${plural(Math.floor(ms / (24 * HOUR)), 'day')} ago`;
}

function recency(key: string, name: string, noun: string, lastOk: number | null, now: number, maxAge: number): HealthItem {
  if (lastOk === null) return { key, ok: false, label: `${name}: never ran`, fix: null };
  const age = Math.max(0, now - lastOk);
  return { key, ok: age <= maxAge, label: `${name}: last ${noun} ${ago(age)}`, fix: null };
}

/** Turns the raw phone state into a checklist. Signed out shows only the sign-in item. */
export function evaluateHealth(input: HealthInput): HealthItem[] {
  if (!input.signedIn) {
    return [{ key: 'sign-in', ok: false, label: 'Sign in with GitHub', fix: 'sign-in' }];
  }
  const items: HealthItem[] = [
    { key: 'sign-in', ok: true, label: 'Signed in', fix: null },
    {
      key: 'location',
      ok: input.backgroundLocation === 'granted',
      label: input.backgroundLocation === 'granted' ? 'Location: allowed all the time' : 'Location: allow all the time',
      fix: input.backgroundLocation === 'granted' ? null : 'grant-location',
    },
    {
      key: 'photos-access',
      ok: input.photosAccess === 'all',
      label:
        input.photosAccess === 'all'
          ? 'Photos: all photos allowed'
          : input.photosAccess === 'limited'
            ? 'Photos: allow all photos, not just some'
            : 'Photos: allow access to photos',
      fix: input.photosAccess === 'all' ? null : 'grant-photos',
    },
    {
      key: 'daylio-folder',
      ok: input.daylioFolder,
      label: input.daylioFolder ? 'Daylio folder chosen' : 'Choose the Daylio folder',
      fix: input.daylioFolder ? null : 'pick-folder',
    },
    {
      key: 'battery',
      ok: input.batteryUnrestricted,
      label: input.batteryUnrestricted ? 'Battery: unrestricted' : 'Battery: set the app to unrestricted',
      fix: input.batteryUnrestricted ? null : 'battery-optimization',
    },
  ];
  const asleep = input.standbyBucket >= RESTRICTED_BUCKET;
  items.push({
    key: 'standby',
    ok: !asleep,
    label: asleep ? 'Samsung has put the app to sleep' : 'App is not asleep',
    fix: asleep ? 'app-settings' : null,
  });
  items.push(recency('place-recent', 'Place', 'report', input.lastOk.place, input.now, PLACE_STALE_MS));
  items.push(recency('photos-recent', 'Photos', 'upload', input.lastOk.photos, input.now, PHOTOS_STALE_MS));
  if (input.daylioFolder) {
    items.push(recency('daylio-recent', 'Daylio', 'check', input.lastOk.daylio, input.now, DAYLIO_STALE_MS));
  }
  return items;
}

async function settled<T>(read: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/**
 * Reads the phone's current state. A check that fails (for example the native module is missing in
 * Expo Go) counts as unknown: standby bucket 0, battery unrestricted, location undetermined.
 */
export async function collectHealth(now = Date.now()): Promise<HealthInput> {
  const [isSignedIn, location, photos, folder, place, photosOk, daylio] = await Promise.all([
    settled(signedIn, false),
    settled<string>(async () => (await Location.getBackgroundPermissionsAsync()).status, 'undetermined'),
    settled(() => MediaLibrary.getPermissionsAsync(false, ['photo']), null),
    readJson<string | null>(FOLDER_KEY, null),
    readJson<number | null>(JOB_KEYS.place, null),
    readJson<number | null>(JOB_KEYS.photos, null),
    readJson<number | null>(JOB_KEYS.daylio, null),
  ]);
  return {
    signedIn: isSignedIn,
    backgroundLocation: location === 'granted' || location === 'denied' ? location : 'undetermined',
    photosAccess: !photos || !photos.granted || photos.accessPrivileges === 'none' ? 'none' : photos.accessPrivileges === 'all' ? 'all' : 'limited',
    daylioFolder: folder !== null,
    batteryUnrestricted: await settled(isIgnoringBatteryOptimizations, true),
    standbyBucket: await settled(standbyBucket, 0),
    lastOk: { place, photos: photosOk, daylio },
    now,
  };
}
