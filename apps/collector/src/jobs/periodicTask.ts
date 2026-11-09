import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { runDaylioJob } from '../daylio/daylioJob';
import { writeJson } from '../lib/store';
import { runPhotoJob } from '../photos/photoJob';

export const PERIODIC_TASK = 'collector-periodic';
const DAYLIO_LAST_OK_KEY = 'job-last-ok:daylio';

/** Runs the photo job, then the Daylio job. One failing never stops the other. */
export async function runPeriodic(now = Date.now()): Promise<void> {
  try {
    await runPhotoJob(now);
  } catch {
    // The photo job records its own success; a failure just leaves its last-ok time old.
  }
  try {
    const result = await runDaylioJob();
    if (!result.error) await writeJson(DAYLIO_LAST_OK_KEY, now);
  } catch {
    // Same: no new last-ok time.
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
