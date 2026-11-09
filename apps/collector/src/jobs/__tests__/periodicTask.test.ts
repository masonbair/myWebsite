import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import { runDaylioJob } from '../../daylio/daylioJob';
import { runPhotoJob } from '../../photos/photoJob';
import { refreshStalePlace } from '../../place/placeTask';
import { collectHealth } from '../../health/health';
import { signedIn, supabase } from '../../lib/supabase';
import { heartbeatKey, registerPeriodic, runPeriodic, sendHeartbeat } from '../periodicTask';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-background-task', () => ({
  getStatusAsync: jest.fn(),
  registerTaskAsync: jest.fn(),
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() }, signedIn: jest.fn() }));
jest.mock('../../health/health', () => ({
  ...jest.requireActual('../../health/health'),
  collectHealth: jest.fn(),
}));
jest.mock('../../photos/photoJob', () => ({ runPhotoJob: jest.fn() }));
jest.mock('../../daylio/daylioJob', () => ({ runDaylioJob: jest.fn() }));
jest.mock('../../place/placeTask', () => ({ refreshStalePlace: jest.fn() }));

const photo = runPhotoJob as jest.Mock;
const daylio = runDaylioJob as jest.Mock;
const NOW = 1_800_000_000_000;
const lastOk = async (name: string) => JSON.parse((await AsyncStorage.getItem(`job-last-ok:${name}`)) ?? 'null');

const rpc = supabase.rpc as jest.Mock;
const signedOutInput = { signedIn: false } as never;

beforeEach(async () => {
  await AsyncStorage.clear();
  (signedIn as jest.Mock).mockReset().mockResolvedValue(true);
  rpc.mockReset().mockResolvedValue({ error: null });
  (collectHealth as jest.Mock).mockReset().mockResolvedValue(signedOutInput);
  photo.mockReset().mockResolvedValue({ uploaded: 0, skipped: 0, error: null });
  daylio.mockReset().mockResolvedValue({ uploaded: 0, skipped: 0, error: null });
  (refreshStalePlace as jest.Mock).mockReset().mockResolvedValue(undefined);
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

  it('refreshes a stale place before the heartbeat, and a place failure stops nothing', async () => {
    (refreshStalePlace as jest.Mock).mockRejectedValue(new Error('boom'));
    await runPeriodic(NOW);
    expect(refreshStalePlace).toHaveBeenCalledWith(NOW);
    expect(daylio).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
    expect((refreshStalePlace as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
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

describe('heartbeat', () => {
  it('runPeriodic ends by sending the evaluated items', async () => {
    await runPeriodic(NOW);
    expect(rpc).toHaveBeenCalledWith('collector_heartbeat', {
      p_status: { at: new Date(NOW).toISOString(), items: [{ key: 'sign-in', ok: false }] },
    });
  });

  it('sends only key and ok, never labels', async () => {
    await sendHeartbeat([{ key: 'battery', ok: true, label: 'Home town', fix: null }], NOW);
    const sent = rpc.mock.calls[0][1].p_status;
    expect(sent.items).toEqual([{ key: 'battery', ok: true }]);
    expect(Object.keys(sent).sort()).toEqual(['at', 'items']);
  });

  it('normalizes keys to the server charset and caps the list', async () => {
    expect(heartbeatKey('Place Recent!')).toBe('place-recent-');
    expect(heartbeatKey('a'.repeat(60))).toHaveLength(40);
    const many = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, ok: true, label: '', fix: null }));
    await sendHeartbeat(many, NOW);
    expect(rpc.mock.calls[0][1].p_status.items).toHaveLength(50);
    for (const item of rpc.mock.calls[0][1].p_status.items) expect(item.key).toMatch(/^[a-z0-9:_-]{1,40}$/);
  });

  it('sends nothing when signed out', async () => {
    (signedIn as jest.Mock).mockResolvedValue(false);
    await runPeriodic(NOW);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not throw when the RPC errors or rejects', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'no' } });
    await expect(sendHeartbeat([], NOW)).resolves.toBeUndefined();
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(sendHeartbeat([], NOW)).resolves.toBeUndefined();
  });

  it('does not throw when health cannot be read', async () => {
    (collectHealth as jest.Mock).mockRejectedValue(new Error('x'));
    await expect(runPeriodic(NOW)).resolves.toBeUndefined();
  });
});
