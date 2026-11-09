import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library/legacy';
import { signedIn, supabase } from '../../lib/supabase';
import { cleanPhoto, ExifRemainsError } from '../cleanPhoto';
import { runPhotoJob } from '../photoJob';

jest.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: jest.fn() }, rpc: jest.fn() },
  signedIn: jest.fn(),
}));
jest.mock('../cleanPhoto', () => ({
  cleanPhoto: jest.fn(),
  ExifRemainsError: class ExifRemainsError extends Error {},
}));
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({ File: jest.fn(() => ({ delete: mockDelete })) }));
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: jest.fn(),
  getAlbumAsync: jest.fn(),
  getAssetsAsync: jest.fn(),
}));

const signed = signedIn as jest.Mock;
const perms = MediaLibrary.getPermissionsAsync as jest.Mock;
const getAlbum = MediaLibrary.getAlbumAsync as jest.Mock;
const getAssets = MediaLibrary.getAssetsAsync as jest.Mock;
const clean = cleanPhoto as jest.Mock;
const rpc = supabase.rpc as jest.Mock;
const storageFrom = supabase.storage.from as jest.Mock;
const upload = jest.fn();
const NOW = 1_800_000_000_000;
const BYTES = new Uint8Array([1, 2, 3]);

const photo = (id: string, creationTime = 1_700_000_000_000, mediaType = 'photo') => ({
  id,
  uri: `file:///album/${id}.jpg`,
  mediaType,
  creationTime,
});
const page = (assets: unknown[], hasNextPage = false) => ({ assets, hasNextPage, endCursor: 'c1' });
const stored = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
  signed.mockReset().mockResolvedValue(true);
  perms.mockReset().mockResolvedValue({ granted: true, accessPrivileges: 'all' });
  getAlbum.mockReset().mockResolvedValue({ id: 'album-1', title: 'Website' });
  getAssets.mockReset().mockResolvedValue(page([]));
  mockDelete.mockReset();
  clean.mockReset().mockResolvedValue({ uri: 'file:///cache/out.jpg', width: 2400, height: 1800, bytes: BYTES });
  upload.mockReset().mockResolvedValue({ error: null });
  storageFrom.mockReset().mockReturnValue({ upload });
  rpc.mockReset().mockResolvedValue({ error: null });
});

describe('runPhotoJob', () => {
  it('does nothing when signed out', async () => {
    signed.mockResolvedValue(false);
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 0, error: 'signed-out' });
    expect(getAlbum).not.toHaveBeenCalled();
  });

  it('stops without uploading when the album is missing', async () => {
    getAlbum.mockResolvedValue(null);
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 0, error: 'album-missing' });
    expect(getAssets).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([['limited', true], [undefined, true]])('refuses photo access of %s', async (accessPrivileges, granted) => {
    perms.mockResolvedValue({ granted, accessPrivileges });
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 0, error: 'photos-partial-access' });
    expect(getAlbum).not.toHaveBeenCalled();
  });

  it.each([['none', false], ['none', true], [undefined, false]])('reports denied access (%s, granted %s)', async (accessPrivileges, granted) => {
    perms.mockResolvedValue({ granted, accessPrivileges });
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 0, error: 'photos-denied' });
    expect(getAlbum).not.toHaveBeenCalled();
  });

  it('reports clean-failed, and does not mark the run ok, when nothing uploads because cleaning fails', async () => {
    getAssets.mockResolvedValue(page([photo('a1'), photo('a2')]));
    clean.mockRejectedValue(new Error('decode failed'));
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 2, error: 'clean-failed' });
    expect(await stored('job-last-ok:photos')).toBeNull();
  });

  it('uploads only photos not yet uploaded, then records the row and the asset id', async () => {
    await AsyncStorage.setItem('photos-uploaded', JSON.stringify(['old']));
    getAssets.mockResolvedValue(page([photo('a1'), photo('old'), photo('b_2', 1_600_000_000_000)]));
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 2, skipped: 0, error: null });
    expect(storageFrom).toHaveBeenCalledWith('photos');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith('collector/a1.jpg', BYTES, { contentType: 'image/jpeg', upsert: false });
    expect(rpc).toHaveBeenCalledWith('collector_add_photo', {
      p_path: 'collector/a1.jpg',
      p_asset_id: 'a1',
      p_taken_at: '2023-11-14T22:13:20.000Z',
      p_width: 2400,
      p_height: 1800,
    });
    expect(await stored('photos-uploaded')).toEqual(['old', 'a1', 'b_2']);
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(await stored('job-last-ok:photos')).toBe(NOW);
  });

  it('asks for the newest photos of the album first', async () => {
    await runPhotoJob(NOW);
    expect(getAssets).toHaveBeenCalledWith({
      album: { id: 'album-1', title: 'Website' },
      mediaType: 'photo',
      sortBy: [['creationTime', false]],
      first: 50,
      after: undefined,
    });
  });

  it('skips videos', async () => {
    getAssets.mockResolvedValue(page([photo('v1', 1_700_000_000_000, 'video'), photo('a1')]));
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 1, skipped: 0, error: null });
    expect(clean).toHaveBeenCalledTimes(1);
  });

  it('counts an asset id the server would reject as skipped and never touches it', async () => {
    getAssets.mockResolvedValue(page([photo('../evil'), photo('a b'), photo('x'.repeat(201)), photo('ok')]));
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 1, skipped: 3, error: null });
    expect(clean).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('leaves the id unrecorded when the row fails, and counts a duplicate upload as uploaded on retry', async () => {
    getAssets.mockResolvedValue(page([photo('a1')]));
    rpc.mockResolvedValueOnce({ error: { message: 'boom' } });
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 0, error: 'rpc-failed' });
    expect(await stored('photos-uploaded')).toBeNull();
    expect(await stored('job-last-ok:photos')).toBeNull();

    upload.mockResolvedValueOnce({ error: { message: 'The resource already exists', statusCode: '409' } });
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 1, skipped: 0, error: null });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(await stored('photos-uploaded')).toEqual(['a1']);
  });

  it('does not call the row function or record the id when the upload fails', async () => {
    getAssets.mockResolvedValue(page([photo('a1')]));
    upload.mockResolvedValue({ error: { message: 'network down' } });
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 0, skipped: 0, error: 'upload-failed' });
    expect(rpc).not.toHaveBeenCalled();
    expect(await stored('photos-uploaded')).toBeNull();
  });

  it('stops after 3 failures in one run', async () => {
    getAssets.mockResolvedValue(page(['a', 'b', 'c', 'd', 'e'].map((id) => photo(id))));
    upload.mockResolvedValue({ error: { message: 'network down' } });
    await runPhotoJob(NOW);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('skips a photo whose metadata survived cleaning and carries on', async () => {
    getAssets.mockResolvedValue(page([photo('bad'), photo('good')]));
    clean.mockRejectedValueOnce(new ExifRemainsError());
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 1, skipped: 1, error: null });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe('collector/good.jpg');
    expect(await stored('photos-uploaded')).toEqual(['good']);
  });

  it('stops after 20 uploads and pages through the album until then', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
    getAssets
      .mockResolvedValueOnce(page(ids.slice(0, 15).map((id) => photo(id)), true))
      .mockResolvedValueOnce(page(ids.slice(15).map((id) => photo(id)), false));
    expect(await runPhotoJob(NOW)).toEqual({ uploaded: 20, skipped: 0, error: null });
    expect(getAssets).toHaveBeenCalledTimes(2);
    expect(getAssets.mock.calls[1][0].after).toBe('c1');
  });

  it('keeps only the newest 2000 uploaded ids', async () => {
    await AsyncStorage.setItem('photos-uploaded', JSON.stringify(Array.from({ length: 2000 }, (_, i) => `h${i}`)));
    getAssets.mockResolvedValue(page([photo('fresh')]));
    await runPhotoJob(NOW);
    const ids = await stored('photos-uploaded');
    expect(ids).toHaveLength(2000);
    expect(ids[0]).toBe('h1');
    expect(ids.at(-1)).toBe('fresh');
  });
});
