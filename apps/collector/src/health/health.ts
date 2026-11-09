import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import { isIgnoringBatteryOptimizations, standbyBucket } from '../../modules/battery-status';
import { readJson } from '../lib/store';
import { DAYLIO_FOLDER_KEY, JOB_LAST_OK_KEY, PLACE_TASK_WANTED_KEY } from '../lib/storageKeys';
import { signedIn } from '../lib/supabase';

export type JobName = 'place' | 'photos' | 'daylio';

export type HealthInput = {
  signedIn: boolean;
  backgroundLocation: 'granted' | 'denied' | 'undetermined';
  photosAccess: 'all' | 'limited' | 'none';
  daylioFolder: boolean;
  /** Null when the phone could not be asked. */
  batteryUnrestricted: boolean | null;
  /** Null when the phone could not be asked; -1 when Android is too old to have buckets. */
  standbyBucket: number | null;
  lastOk: Record<JobName, number | null>;
  /** False when the user switched off place reporting, so a quiet place job is expected. */
  placeWanted: boolean;
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
// Android buckets: 45 is restricted, 50 is never.
const RESTRICTED_BUCKET = 45;
const PHOTOS_STALE_MS = 3 * HOUR;
const DAYLIO_STALE_MS = 3 * HOUR;
// Location only reports on movement plus every 6 hours, so a day of silence means it stopped.
const PLACE_STALE_MS = 24 * HOUR;


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

function batteryItem(unrestricted: boolean | null, dev: boolean): HealthItem {
  if (unrestricted === null) {
    return { key: 'battery', ok: dev, label: "Can't read the battery setting", fix: 'battery-optimization' };
  }
  return {
    key: 'battery',
    ok: unrestricted,
    label: unrestricted ? 'Battery: unrestricted' : 'Battery: set the app to unrestricted',
    fix: unrestricted ? null : 'battery-optimization',
  };
}

function standbyItem(bucket: number | null, dev: boolean): HealthItem {
  if (bucket === null) {
    return { key: 'standby', ok: dev, label: "Can't read whether Android has limited the app", fix: 'app-settings' };
  }
  const limited = bucket >= RESTRICTED_BUCKET;
  return {
    key: 'standby',
    ok: !limited,
    label: limited ? 'Android has limited the app in the background' : 'App is not limited in the background',
    fix: limited ? 'app-settings' : null,
  };
}

/** Turns the raw phone state into a checklist. Signed out shows only the sign-in item. */
export function evaluateHealth(input: HealthInput, dev: boolean = __DEV__): HealthItem[] {
  return buildItems(input, dev).map((item) => (item.ok ? { ...item, fix: null } : item));
}

function buildItems(input: HealthInput, dev: boolean): HealthItem[] {
  // Unreadable settings are fine in dev (Expo Go has no native module); in a real build they mean something is broken.
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
    batteryItem(input.batteryUnrestricted, dev),
  ];
  items.push(standbyItem(input.standbyBucket, dev));
  if (input.placeWanted) items.push(recency('place-recent', 'Place', 'report', input.lastOk.place, input.now, PLACE_STALE_MS));
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

function photosAccess(p: { granted: boolean; accessPrivileges?: string } | null): HealthInput['photosAccess'] {
  if (p?.accessPrivileges === 'limited') return 'limited';
  if (!p || !p.granted || p.accessPrivileges === 'none') return 'none';
  return p.accessPrivileges === 'all' ? 'all' : 'limited';
}

/**
 * Reads the phone's current state. A check that fails (for example the native module is missing in
 * Expo Go) counts as unknown (null); evaluateHealth decides whether unknown is acceptable.
 */
export async function collectHealth(now = Date.now()): Promise<HealthInput> {
  const [isSignedIn, location, photos, folder, place, photosOk, daylio, placeWanted] = await Promise.all([
    settled(signedIn, false),
    settled<string>(async () => (await Location.getBackgroundPermissionsAsync()).status, 'undetermined'),
    settled(() => MediaLibrary.getPermissionsAsync(false, ['photo']), null),
    readJson<string | null>(DAYLIO_FOLDER_KEY, null),
    readJson<number | null>(JOB_LAST_OK_KEY.place, null),
    readJson<number | null>(JOB_LAST_OK_KEY.photos, null),
    readJson<number | null>(JOB_LAST_OK_KEY.daylio, null),
    readJson<boolean>(PLACE_TASK_WANTED_KEY, false),
  ]);
  return {
    signedIn: isSignedIn,
    backgroundLocation: location === 'granted' || location === 'denied' ? location : 'undetermined',
    photosAccess: photosAccess(photos),
    daylioFolder: folder !== null,
    batteryUnrestricted: await settled(isIgnoringBatteryOptimizations, null),
    standbyBucket: await settled(standbyBucket, null),
    lastOk: { place, photos: photosOk, daylio },
    placeWanted,
    now,
  };
}
