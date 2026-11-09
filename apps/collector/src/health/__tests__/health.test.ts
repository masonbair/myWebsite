import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Battery from '../../../modules/battery-status';
import { signedIn } from '../../lib/supabase';
import { collectHealth, evaluateHealth, type HealthInput } from '../health';

jest.mock('../../../modules/battery-status', () => ({
  isIgnoringBatteryOptimizations: jest.fn(() => true),
  standbyBucket: jest.fn(() => 10),
}));
jest.mock('expo-location', () => ({ getBackgroundPermissionsAsync: jest.fn() }));
jest.mock('expo-media-library/legacy', () => ({ getPermissionsAsync: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ signedIn: jest.fn() }));

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const good: HealthInput = {
  signedIn: true,
  backgroundLocation: 'granted',
  photosAccess: 'all',
  daylioFolder: true,
  batteryUnrestricted: true,
  standbyBucket: 10,
  lastOk: { place: NOW - HOUR, photos: NOW - HOUR, daylio: NOW - HOUR },
  placeWanted: true,
  now: NOW,
};

const find = (input: HealthInput, key: string, dev = true) => evaluateHealth(input, dev).find((i) => i.key === key);

describe('evaluateHealth', () => {
  it('marks every item ok when all is well', () => {
    const items = evaluateHealth(good);
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((i) => i.ok && i.fix === null)).toBe(true);
  });

  it('offers no fix for an item that is ok, even an unreadable one in dev', () => {
    const items = evaluateHealth({ ...good, batteryUnrestricted: null, standbyBucket: null }, true);
    expect(items.every((i) => !i.ok || i.fix === null)).toBe(true);
    expect(items.find((i) => i.key === 'battery')).toMatchObject({ ok: true, fix: null });
  });

  it('hides the place staleness item when place reporting is switched off', () => {
    const stale = { ...good, lastOk: { ...good.lastOk, place: null } };
    expect(find(stale, 'place-recent')).toMatchObject({ ok: false });
    expect(find({ ...stale, placeWanted: false }, 'place-recent')).toBeUndefined();
  });

  it('shows only the sign-in item when signed out', () => {
    const items = evaluateHealth({ ...good, signedIn: false });
    expect(items).toEqual([expect.objectContaining({ key: 'sign-in', ok: false, fix: 'sign-in' })]);
  });

  it('flags battery optimization', () => {
    expect(find({ ...good, batteryUnrestricted: false }, 'battery')).toMatchObject({ ok: false, fix: 'battery-optimization' });
  });

  it.each([45, 50])('flags standby bucket %i', (bucket) => {
    const item = find({ ...good, standbyBucket: bucket }, 'standby');
    expect(item).toMatchObject({ ok: false, fix: 'app-settings' });
    expect(item?.label).toMatch(/limited the app in the background/);
  });

  it.each([-1, 0, 5, 10, 20, 30, 40])('accepts standby bucket %i', (bucket) => {
    expect(find({ ...good, standbyBucket: bucket }, 'standby')?.ok).toBe(true);
  });

  it('fails closed outside dev when the battery setting cannot be read', () => {
    const input = { ...good, batteryUnrestricted: null };
    expect(find(input, 'battery', false)).toMatchObject({ ok: false, fix: 'battery-optimization', label: "Can't read the battery setting" });
    expect(find(input, 'battery', true)?.ok).toBe(true);
  });

  it('fails closed outside dev when the standby bucket cannot be read', () => {
    const input = { ...good, standbyBucket: null };
    expect(find(input, 'standby', false)).toMatchObject({ ok: false, fix: 'app-settings' });
    expect(find(input, 'standby', true)?.ok).toBe(true);
  });

  it('asks for all photos when access is limited', () => {
    const item = find({ ...good, photosAccess: 'limited' }, 'photos-access');
    expect(item).toMatchObject({ ok: false, fix: 'grant-photos' });
    expect(item?.label).toMatch(/all photos/i);
  });

  it('asks for photo access when denied', () => {
    expect(find({ ...good, photosAccess: 'none' }, 'photos-access')).toMatchObject({ ok: false, fix: 'grant-photos' });
  });

  it('flags background location that is not granted', () => {
    expect(find({ ...good, backgroundLocation: 'denied' }, 'location')).toMatchObject({ ok: false, fix: 'grant-location' });
  });

  it('flags a missing Daylio folder', () => {
    expect(find({ ...good, daylioFolder: false }, 'daylio-folder')).toMatchObject({ ok: false, fix: 'pick-folder' });
  });

  it('flags photo uploads older than 3 hours, in words', () => {
    const item = find({ ...good, lastOk: { ...good.lastOk, photos: NOW - 5 * HOUR } }, 'photos-recent');
    expect(item).toMatchObject({ ok: false });
    expect(item?.label).toBe('Photos: last upload 5 hours ago');
  });

  it('accepts photo uploads just under 3 hours old', () => {
    expect(find({ ...good, lastOk: { ...good.lastOk, photos: NOW - 2.9 * HOUR } }, 'photos-recent')?.ok).toBe(true);
  });

  it('says never ran when a job has no last-ok time', () => {
    const item = find({ ...good, lastOk: { ...good.lastOk, photos: null } }, 'photos-recent');
    expect(item).toMatchObject({ ok: false });
    expect(item?.label).toMatch(/never ran/);
  });

  it('flags a place report older than 24 hours', () => {
    expect(find({ ...good, lastOk: { ...good.lastOk, place: NOW - 25 * HOUR } }, 'place-recent')).toMatchObject({ ok: false });
    expect(find({ ...good, lastOk: { ...good.lastOk, place: NOW - 23 * HOUR } }, 'place-recent')?.ok).toBe(true);
  });

  it('flags a stale Daylio check only when a folder is chosen', () => {
    const stale = { ...good.lastOk, daylio: NOW - 5 * HOUR };
    expect(find({ ...good, lastOk: stale }, 'daylio-recent')?.ok).toBe(false);
    expect(find({ ...good, daylioFolder: false, lastOk: stale }, 'daylio-recent')).toBeUndefined();
  });
});

describe('collectHealth', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.mocked(signedIn).mockResolvedValue(true);
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
    jest.mocked(MediaLibrary.getPermissionsAsync).mockResolvedValue({ granted: true, accessPrivileges: 'all' } as never);
    jest.mocked(Battery.isIgnoringBatteryOptimizations).mockReturnValue(true);
    jest.mocked(Battery.standbyBucket).mockReturnValue(10);
  });

  it('reads the stored state', async () => {
    await AsyncStorage.setItem('daylio-folder-uri', JSON.stringify('content://folder'));
    await AsyncStorage.setItem('job-last-ok:place', JSON.stringify(111));
    const input = await collectHealth(NOW);
    expect(input).toMatchObject({
      signedIn: true,
      backgroundLocation: 'granted',
      photosAccess: 'all',
      daylioFolder: true,
      batteryUnrestricted: true,
      standbyBucket: 10,
      lastOk: { place: 111, photos: null, daylio: null },
      now: NOW,
    });
  });

  it('maps denied and limited photo access', async () => {
    jest.mocked(MediaLibrary.getPermissionsAsync).mockResolvedValue({ granted: false, accessPrivileges: 'none' } as never);
    expect((await collectHealth(NOW)).photosAccess).toBe('none');
    jest.mocked(MediaLibrary.getPermissionsAsync).mockResolvedValue({ granted: true, accessPrivileges: 'limited' } as never);
    expect((await collectHealth(NOW)).photosAccess).toBe('limited');
  });

  it('reports unknown (null) when the native module is missing', async () => {
    jest.mocked(Battery.isIgnoringBatteryOptimizations).mockReturnValue(null);
    jest.mocked(Battery.standbyBucket).mockReturnValue(null);
    const input = await collectHealth(NOW);
    expect(input.batteryUnrestricted).toBeNull();
    expect(input.standbyBucket).toBeNull();
  });

  it('prefers limited when the app reports limited but not granted', async () => {
    jest.mocked(MediaLibrary.getPermissionsAsync).mockResolvedValue({ granted: false, accessPrivileges: 'limited' } as never);
    expect((await collectHealth(NOW)).photosAccess).toBe('limited');
  });

  it('does not crash when a native check throws', async () => {
    jest.mocked(Battery.standbyBucket).mockImplementation(() => {
      throw new Error('boom');
    });
    jest.mocked(Location.getBackgroundPermissionsAsync).mockRejectedValue(new Error('boom'));
    const input = await collectHealth(NOW);
    expect(input.standbyBucket).toBeNull();
    expect(input.backgroundLocation).toBe('undetermined');
  });
});
