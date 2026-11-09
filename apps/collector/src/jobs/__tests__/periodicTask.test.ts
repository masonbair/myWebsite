import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import { runDaylioJob } from '../../daylio/daylioJob';
import { runPhotoJob } from '../../photos/photoJob';
import { registerPeriodic, runPeriodic } from '../periodicTask';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-background-task', () => ({
  getStatusAsync: jest.fn(),
  registerTaskAsync: jest.fn(),
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
jest.mock('../../photos/photoJob', () => ({ runPhotoJob: jest.fn() }));
jest.mock('../../daylio/daylioJob', () => ({ runDaylioJob: jest.fn() }));

const photo = runPhotoJob as jest.Mock;
const daylio = runDaylioJob as jest.Mock;
const NOW = 1_800_000_000_000;
const lastOk = async (name: string) => JSON.parse((await AsyncStorage.getItem(`job-last-ok:${name}`)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
  photo.mockReset().mockResolvedValue({ uploaded: 0, skipped: 0, error: null });
  daylio.mockReset().mockResolvedValue({ uploaded: 0, skipped: 0, error: null });
});

describe('runPeriodic', () => {
  it('runs both jobs and records Daylio success (the photo job records its own)', async () => {
    await runPeriodic(NOW);
    expect(photo).toHaveBeenCalledWith(NOW);
    expect(daylio).toHaveBeenCalled();
    expect(await lastOk('daylio')).toBe(NOW);
    expect(await lastOk('photos')).toBeNull();
  });

  it('still runs Daylio when the photo job throws', async () => {
    photo.mockRejectedValue(new Error('boom'));
    await runPeriodic(NOW);
    expect(daylio).toHaveBeenCalled();
    expect(await lastOk('daylio')).toBe(NOW);
  });

  it('still runs photos when Daylio throws, and records no Daylio success', async () => {
    daylio.mockRejectedValue(new Error('boom'));
    await runPeriodic(NOW);
    expect(photo).toHaveBeenCalled();
    expect(await lastOk('daylio')).toBeNull();
  });

  it('records no Daylio success when it returns an error', async () => {
    daylio.mockResolvedValue({ uploaded: 0, skipped: 0, error: 'no-folder' });
    await runPeriodic(NOW);
    expect(await lastOk('daylio')).toBeNull();
  });
});

describe('registerPeriodic', () => {
  it('registers a 15 minute task when available', async () => {
    (BackgroundTask.getStatusAsync as jest.Mock).mockResolvedValue(2);
    await registerPeriodic();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith('collector-periodic', { minimumInterval: 15 });
  });

  it('does nothing when background tasks are restricted', async () => {
    (BackgroundTask.getStatusAsync as jest.Mock).mockResolvedValue(1);
    await registerPeriodic();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });
});
