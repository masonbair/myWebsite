import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { TABLE } from '../../../../shared/collector-contract';
import { readJson, writeJson } from '../lib/store';
import { JOB_LAST_OK_KEY } from '../lib/storageKeys';
import { signedIn, supabase } from '../lib/supabase';
import type { Point } from './nearestPlace';
import { loadPrivatePlaces } from './privatePlaces';
import { toPlaceRow, toReport, type PlaceReport } from './toReport';

export const PLACE_TASK = 'collector-place';
const LAST_SENT_KEY = 'place-last-sent';
// A repeat of the same place this often keeps "last seen" fresh on the site.
const RESEND_MS = 6 * 60 * 60_000;

type Fix = { coords: Point };
type LastSent = { report: PlaceReport; at: number };

/** The server rejects names it does not know, so anything that does not look like an IANA zone becomes null. */
export function deviceTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && (zone.includes('/') || zone === 'UTC') ? zone : null;
}

function samePlace(a: PlaceReport, b: PlaceReport): boolean {
  return a.city === b.city && a.region === b.region && a.country === b.country && a.private === b.private;
}

/** One background wake. The fix is matched on the phone; only a place name ever leaves it. */
export async function runPlaceTask(fixes: Fix[], now = Date.now(), timeZone: string | null = deviceTimeZone()): Promise<void> {
  const fix = fixes.at(-1);
  if (!fix || !(await signedIn())) return;
  const report = toReport(fix.coords, await loadPrivatePlaces());
  if (!report) return;
  const last = await readJson<LastSent | null>(LAST_SENT_KEY, null);
  if (!last || !samePlace(last.report, report) || now - last.at >= RESEND_MS) {
    const { error } = await supabase.from(TABLE.place).insert(toPlaceRow(report, timeZone));
    // Unsaved, so the next wake tries again.
    if (error) return;
    await writeJson(LAST_SENT_KEY, { report, at: now } satisfies LastSent);
  }
  await writeJson(JOB_LAST_OK_KEY.place, now);
}

async function startPlaceTask(): Promise<void> {
  await Location.startLocationUpdatesAsync(PLACE_TASK, {
    accuracy: Location.Accuracy.Lowest,
    distanceInterval: 1000,
    deferredUpdatesInterval: 15 * 60_000,
    pausesUpdatesAutomatically: true,
  });
}

async function stopPlaceTask(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(PLACE_TASK)) await Location.stopLocationUpdatesAsync(PLACE_TASK);
}

let wanted: 'on' | 'off' | null = null;
let queue: Promise<void> = Promise.resolve();

/** Runs or stops the task, one change at a time: a quick on-then-off can never leave it running. */
export function syncPlaceTask(next: 'on' | 'off'): Promise<void> {
  wanted = next;
  queue = queue.then(async () => {
    if (wanted !== next) return;
    const allowed = next === 'on' && (await Location.getBackgroundPermissionsAsync()).status === 'granted';
    if (wanted !== next) return;
    if (allowed) await startPlaceTask();
    else await stopPlaceTask();
    // A failed start or stop is tried again on the next sync, when the app next opens.
  }).catch(() => {});
  return queue;
}

// Imported from index.js: the OS can wake the app with no screen, so the task can't wait for the UI.
if (Platform.OS === 'android') {
  TaskManager.defineTask<{ locations: Fix[] }>(PLACE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    await runPlaceTask(data.locations);
  });
}
