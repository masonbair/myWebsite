import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { signedIn, supabase } from '../../lib/supabase';
import { addPrivatePlace } from '../privatePlaces';
import { deviceTimeZone, PLACE_TASK, runPlaceTask, syncPlaceTask } from '../placeTask';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() }, signedIn: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1 },
  getBackgroundPermissionsAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const insert = jest.fn();
const from = supabase.from as jest.Mock;
const signed = signedIn as jest.Mock;
const bgPerm = Location.getBackgroundPermissionsAsync as jest.Mock;
const started = Location.hasStartedLocationUpdatesAsync as jest.Mock;
const LISBON = [{ coords: { latitude: 38.72, longitude: -9.14 } }];
const LONDON = [{ coords: { latitude: 51.5074, longitude: -0.1278 } }];
const HOUR = 3_600_000;
const ZONE = 'Europe/Lisbon';
const granted = { status: 'granted', granted: true, canAskAgain: true };

const stored = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
  insert.mockReset().mockResolvedValue({ error: null });
  from.mockReset().mockReturnValue({ insert });
  signed.mockReset().mockResolvedValue(true);
  bgPerm.mockReset().mockResolvedValue(granted);
  started.mockReset().mockResolvedValue(false);
});

describe('runPlaceTask', () => {
  it('inserts the first fix as a place row and records it', async () => {
    await runPlaceTask(LISBON, 1000, ZONE);
    expect(from).toHaveBeenCalledWith('now_place');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      city: 'Lisbon', region: expect.any(String), country: 'Portugal', private: false, time_zone: ZONE,
    });
    expect(await stored('place-last-sent')).toMatchObject({ at: 1000, report: { city: 'Lisbon', country: 'Portugal' } });
    expect(await stored('job-last-ok:place')).toBe(1000);
  });

  it('does not resend the same place within 6 hours, but still marks the job ok', async () => {
    await runPlaceTask(LISBON, 0, ZONE);
    await runPlaceTask(LISBON, 5 * HOUR, ZONE);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(await stored('place-last-sent')).toMatchObject({ at: 0 });
    expect(await stored('job-last-ok:place')).toBe(5 * HOUR);
  });

  it('resends the same place after 6 hours', async () => {
    await runPlaceTask(LISBON, 0, ZONE);
    await runPlaceTask(LISBON, 6 * HOUR, ZONE);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(await stored('place-last-sent')).toMatchObject({ at: 6 * HOUR });
  });

  it('sends a different place at once', async () => {
    await runPlaceTask(LISBON, 0, ZONE);
    await runPlaceTask(LONDON, HOUR, ZONE);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'London', country: 'United Kingdom' }));
  });

  it('treats a switch into a private place as a change, with no city sent', async () => {
    await runPlaceTask(LISBON, 0, ZONE);
    await addPrivatePlace('test-a', LISBON[0].coords);
    await runPlaceTask(LISBON, HOUR, ZONE);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenLastCalledWith({
      city: null, region: expect.any(String), country: 'Portugal', private: true, time_zone: ZONE,
    });
  });

  it('does nothing when no place is near', async () => {
    await runPlaceTask([{ coords: { latitude: 0, longitude: -30 } }], 1000, ZONE);
    expect(insert).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('does nothing when signed out', async () => {
    signed.mockResolvedValue(false);
    await runPlaceTask(LISBON, 1000, ZONE);
    expect(insert).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('keeps the old state on an insert error so the next wake retries', async () => {
    insert.mockResolvedValueOnce({ error: new Error('offline') });
    await runPlaceTask(LISBON, 1000, ZONE);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    await runPlaceTask(LISBON, 2000, ZONE);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(await stored('job-last-ok:place')).toBe(2000);
  });

  it('sends nothing coordinate-like', async () => {
    await addPrivatePlace('test-a', LONDON[0].coords);
    for (const fixes of [LISBON, LONDON]) await runPlaceTask(fixes, 0, ZONE);
    for (const [row] of insert.mock.calls) {
      expect(Object.keys(row).filter((k) => /lat|lng|lon/i.test(k))).toEqual([]);
      expect(JSON.stringify(row)).not.toMatch(/38\.7|51\.50|test-a/);
    }
  });
});

describe('deviceTimeZone', () => {
  const zone = (value: string | undefined) =>
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: value } as Intl.ResolvedDateTimeFormatOptions);
  afterEach(() => jest.restoreAllMocks());

  it.each([['Europe/Lisbon', 'Europe/Lisbon'], ['UTC', 'UTC'], ['GMT+1', null], ['', null], [undefined, null]])(
    '%s -> %s', (given, expected) => {
      zone(given);
      expect(deviceTimeZone()).toBe(expected);
    },
  );
});

describe('syncPlaceTask', () => {
  it('on starts approximate, battery-light updates', async () => {
    await syncPlaceTask('on');
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(PLACE_TASK, {
      accuracy: Location.Accuracy.Lowest,
      distanceInterval: 1000,
      deferredUpdatesInterval: 15 * 60_000,
      pausesUpdatesAutomatically: true,
    });
  });

  it('on without the phone\'s yes does not start', async () => {
    bgPerm.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
    await syncPlaceTask('on');
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('off stops a running task', async () => {
    started.mockResolvedValue(true);
    await syncPlaceTask('off');
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(PLACE_TASK);
  });

  it('a quick on then off never leaves it running', async () => {
    let release: (v: unknown) => void = () => {};
    bgPerm.mockImplementationOnce(() => new Promise((r) => { release = () => r(granted); }));
    const on = syncPlaceTask('on');
    const off = syncPlaceTask('off');
    release(granted);
    await on;
    await off;
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});
