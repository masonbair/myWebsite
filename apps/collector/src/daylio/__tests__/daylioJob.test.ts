import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File } from 'expo-file-system';
import { daylioPath } from '../../../../../shared/collector-contract';
import { signedIn, supabase } from '../../lib/supabase';
import { pickDaylioFolder, runDaylioJob } from '../daylioJob';

jest.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: jest.fn() }, rpc: jest.fn() },
  signedIn: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Directory: Object.assign(jest.fn(), { pickDirectoryAsync: jest.fn() }),
  File: class {},
}));

const MockDirectory = Directory as unknown as jest.Mock & { pickDirectoryAsync: jest.Mock };
const signed = signedIn as jest.Mock;
const rpc = supabase.rpc as jest.Mock;
const storageFrom = supabase.storage.from as jest.Mock;
const upload = jest.fn();
const MB = 1024 * 1024;
const FOLDER = 'content://tree/daylio';

const bytes = jest.fn();
const file = (name: string, size = 1000, modificationTime: number | null = 1_762_000_000_000) =>
  Object.assign(new File(), { name, size, modificationTime, bytes });
const listing = (...entries: unknown[]) => MockDirectory.mockImplementation(() => ({ list: () => entries }));
const stored = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('daylio-folder-uri', JSON.stringify(FOLDER));
  signed.mockReset().mockResolvedValue(true);
  upload.mockReset().mockResolvedValue({ error: null });
  storageFrom.mockReset().mockReturnValue({ upload });
  rpc.mockReset().mockResolvedValue({ error: null });
  bytes.mockReset().mockResolvedValue(new Uint8Array([1, 2]));
  MockDirectory.mockReset();
  MockDirectory.pickDirectoryAsync.mockReset();
  listing();
});

describe('pickDaylioFolder', () => {
  it('stores the picked folder', async () => {
    await AsyncStorage.clear();
    MockDirectory.pickDirectoryAsync.mockResolvedValue({ uri: 'content://tree/new' });
    expect(await pickDaylioFolder()).toBe(true);
    expect(await stored('daylio-folder-uri')).toBe('content://tree/new');
  });

  it('returns false when the picker is cancelled', async () => {
    await AsyncStorage.clear();
    MockDirectory.pickDirectoryAsync.mockRejectedValue(new Error('cancelled'));
    expect(await pickDaylioFolder()).toBe(false);
    expect(await stored('daylio-folder-uri')).toBeNull();
  });
});

describe('runDaylioJob', () => {
  it('does nothing when signed out', async () => {
    signed.mockResolvedValue(false);
    expect(await runDaylioJob()).toEqual({ uploaded: 0, skipped: 0, error: 'signed-out' });
  });

  it('reports no-folder when none was picked', async () => {
    await AsyncStorage.clear();
    expect(await runDaylioJob()).toEqual({ uploaded: 0, skipped: 0, error: 'no-folder' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads only csv and daylio files, then records each with the same size and time', async () => {
    const m = 1_762_000_000_123;
    listing(file('daylio_export_2026_11_04.csv', 1000, m), file('backup_2026_11_04.daylio', 2000, m), file('notes.txt'));
    expect(await runDaylioJob()).toEqual({ uploaded: 2, skipped: 0, error: null });
    expect(storageFrom).toHaveBeenCalledWith('daylio');
    expect(upload).toHaveBeenCalledWith(daylioPath('daylio_export_2026_11_04.csv', 1000, m), expect.any(Uint8Array), {
      contentType: 'text/csv',
      upsert: false,
    });
    expect(upload).toHaveBeenCalledWith(daylioPath('backup_2026_11_04.daylio', 2000, m), expect.any(Uint8Array), {
      contentType: 'application/octet-stream',
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith('collector_add_daylio_export', {
      p_path: daylioPath('daylio_export_2026_11_04.csv', 1000, m),
      p_filename: 'daylio_export_2026_11_04.csv',
      p_size_bytes: 1000,
      p_modified_at: new Date(m).toISOString(),
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('uploads again only when size or time changed', async () => {
    listing(file('a.csv', 10, 5000));
    await runDaylioJob();
    expect(await stored('daylio-uploaded')).toEqual(['a.csv|10|5000']);
    upload.mockClear();
    expect((await runDaylioJob()).uploaded).toBe(0);
    expect(upload).not.toHaveBeenCalled();
    listing(file('a.csv', 11, 5000), file('a.csv', 10, 6000));
    expect((await runDaylioJob()).uploaded).toBe(2);
  });

  it('counts a duplicate upload as uploaded and still calls the RPC', async () => {
    listing(file('a.csv'));
    upload.mockResolvedValue({ error: { message: 'The resource already exists', statusCode: '409' } });
    expect(await runDaylioJob()).toEqual({ uploaded: 1, skipped: 0, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await stored('daylio-uploaded')).toEqual(['a.csv|1000|1762000000000']);
  });

  it('does not record a file when the RPC fails', async () => {
    listing(file('a.csv'));
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    expect(await runDaylioJob()).toEqual({ uploaded: 0, skipped: 0, error: 'rpc-failed' });
    expect(await stored('daylio-uploaded')).toBeNull();
  });

  it('does not record a file when the upload fails, and keeps going', async () => {
    listing(file('a.csv', 1), file('b.csv', 2));
    upload.mockResolvedValueOnce({ error: { message: 'down' } });
    expect(await runDaylioJob()).toEqual({ uploaded: 1, skipped: 0, error: 'upload-failed' });
    expect(await stored('daylio-uploaded')).toEqual(['b.csv|2|1762000000000']);
  });

  it('skips files over 25 MB and files with no readable time or size, without an error', async () => {
    listing(file('big.csv', 25 * MB + 1), file('ok.csv', 25 * MB), file('notime.csv', 5, null), file('empty.csv', 0));
    expect(await runDaylioJob()).toEqual({ uploaded: 1, skipped: 3, error: null });
  });

  it('reports folder-access-lost when the listing throws', async () => {
    MockDirectory.mockImplementation(() => ({
      list: () => {
        throw new Error('permission revoked');
      },
    }));
    expect(await runDaylioJob()).toEqual({ uploaded: 0, skipped: 0, error: 'folder-access-lost' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('ignores subfolders', async () => {
    listing({ name: 'sub.csv' });
    expect(await runDaylioJob()).toEqual({ uploaded: 0, skipped: 0, error: null });
  });
});
