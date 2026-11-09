import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { RPC, type HeartbeatArgs } from '../../../../shared/collector-contract';
import { runDaylioJob } from '../daylio/daylioJob';
import { collectHealth, evaluateHealth, type HealthItem } from '../health/health';
import { signedIn, supabase } from '../lib/supabase';
import { writeJson } from '../lib/store';
import { JOB_LAST_OK_KEY } from '../lib/storageKeys';
import { runPhotoJob } from '../photos/photoJob';
import { refreshStalePlace } from '../place/placeTask';

export const PERIODIC_TASK = 'collector-periodic';

const MAX_HEARTBEAT_ITEMS = 50;

/** The server only accepts keys of 1-40 of a-z, 0-9, ':', '_', '-'. */
export function heartbeatKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9:_-]/g, '-').slice(0, 40);
}

/** Tells the server which checks pass. Sends keys and ok flags only, never labels. A failure is ignored. */
export async function sendHeartbeat(items: HealthItem[], now: number): Promise<void> {
  try {
    if (!(await signedIn())) return;
    const args = {
      p_status: {
        at: new Date(now).toISOString(),
        items: items
          .map((i) => ({ key: heartbeatKey(i.key), ok: i.ok }))
          .filter((i) => i.key !== '')
          .slice(0, MAX_HEARTBEAT_ITEMS),
      },
    } satisfies HeartbeatArgs;
    await supabase.rpc(RPC.heartbeat, args);
  } catch {
    // The heartbeat is only a signal; the next run sends another.
  }
}

/** Runs the photo job, the Daylio job, a stale place resend, then the heartbeat. One failing never stops the others. */
export async function runPeriodic(now = Date.now()): Promise<void> {
  try {
    await runPhotoJob(now);
  } catch {
    // The photo job records its own success; a failure just leaves its last-ok time old.
  }
  try {
    const result = await runDaylioJob();
    if (!result.error) await writeJson(JOB_LAST_OK_KEY.daylio, now);
  } catch {
    // Same: no new last-ok time.
  }
  try {
    await refreshStalePlace(now);
  } catch {
    // The next run tries again.
  }
  try {
    await sendHeartbeat(evaluateHealth(await collectHealth(now)), now);
  } catch {
    // Health could not be read; skip this heartbeat.
  }
}

TaskManager.defineTask(PERIODIC_TASK, async () => {
  await runPeriodic();
  return BackgroundTask.BackgroundTaskResult.Success;
});

/** Asks the OS to wake the app about every 15 minutes (a minimum; the OS may wait longer). */
export async function registerPeriodic(): Promise<void> {
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
  await BackgroundTask.registerTaskAsync(PERIODIC_TASK, { minimumInterval: 15 });
}
