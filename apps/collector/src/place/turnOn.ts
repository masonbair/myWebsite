import { writeJson } from '../lib/store';
import { PLACE_TASK_WANTED_KEY } from '../lib/storageKeys';
import { loadPrivatePlaces } from './privatePlaces';
import { syncPlaceTask } from './placeTask';

export type FirstSendAnswer = 'send' | 'mark-first';

/**
 * Turns place reporting on. With no private places yet, asks first, because the first report would
 * carry the current city. Returns false when the switch must stay off.
 */
export async function turnOnPlaceReporting(askAtPrivatePlace: () => Promise<FirstSendAnswer>): Promise<boolean> {
  if ((await loadPrivatePlaces()).length === 0 && (await askAtPrivatePlace()) === 'mark-first') return false;
  await writeJson(PLACE_TASK_WANTED_KEY, true);
  await syncPlaceTask('on');
  return true;
}
