import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { BUCKET, PHOTO_PREFIX, RPC, type AddPhotoArgs } from '../../../../shared/collector-contract';
import { readJson, writeJson } from '../lib/store';
import { JOB_LAST_OK_KEY } from '../lib/storageKeys';
import { signedIn, supabase } from '../lib/supabase';
import { cleanPhoto } from './cleanPhoto';

export const ALBUM_NAME = 'Website';
export type PhotoJobResult = { uploaded: number; skipped: number; error: string | null };

const UPLOADED_KEY = 'photos-uploaded';
// Older ids fall off, so a photo that old is re-cleaned and re-uploaded (a no-op server side); the album is expected to stay small.
const KEEP_IDS = 2000;
const MAX_UPLOADS_PER_RUN = 20;
const MAX_FAILURES_PER_RUN = 3;
const PAGE_SIZE = 50;
// Same pattern as the database check on collector_photo.asset_id.
const ASSET_ID = /^[A-Za-z0-9_-]{1,200}$/;

// Android reports creationTime 0 for files without an EXIF date (saved images, some screenshots).
function takenAt(asset: { creationTime: number; modificationTime: number }): number | null {
  const time = asset.creationTime > 0 ? asset.creationTime : asset.modificationTime;
  return Number.isFinite(time) && time > 0 ? time : null;
}

type StorageError = { message?: string; statusCode?: string | number };

function isDuplicate(error: StorageError): boolean {
  return String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message ?? '');
}

function discard(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // The cache directory is cleared by the OS anyway.
  }
}

/** Uploads new photos from the "Website" album with metadata removed on the phone. At most 20 per run. */
export async function runPhotoJob(now = Date.now()): Promise<PhotoJobResult> {
  const result: PhotoJobResult = { uploaded: 0, skipped: 0, error: null };
  if (!(await signedIn())) return { ...result, error: 'signed-out' };

  const permission = await MediaLibrary.getPermissionsAsync(false, ['photo']);
  if (permission.accessPrivileges === 'limited') return { ...result, error: 'photos-partial-access' };
  if (!permission.granted || permission.accessPrivileges === 'none') return { ...result, error: 'photos-denied' };
  if (permission.accessPrivileges !== 'all') return { ...result, error: 'photos-partial-access' };

  const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
  if (!album) return { ...result, error: 'album-missing' };

  const done = await readJson<string[]>(UPLOADED_KEY, []);
  const doneSet = new Set(done);
  let failures = 0;
  let cleanFailures = 0;
  let after: string | undefined;

  paging: for (;;) {
    const page = await MediaLibrary.getAssetsAsync({
      album,
      mediaType: 'photo',
      sortBy: [['creationTime', false]],
      first: PAGE_SIZE,
      after,
    });
    for (const asset of page.assets) {
      if (result.uploaded >= MAX_UPLOADS_PER_RUN || failures >= MAX_FAILURES_PER_RUN) break paging;
      if (asset.mediaType !== 'photo' || doneSet.has(asset.id)) continue;
      const taken = takenAt(asset);
      if (!ASSET_ID.test(asset.id) || taken === null) {
        result.skipped += 1;
        continue;
      }

      let cleaned;
      try {
        cleaned = await cleanPhoto(asset.uri);
      } catch {
        result.skipped += 1;
        cleanFailures += 1;
        continue;
      }

      try {
        const path = `${PHOTO_PREFIX}${asset.id}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET.photos)
          .upload(path, cleaned.bytes, { contentType: 'image/jpeg', upsert: false });
        if (uploadError && !isDuplicate(uploadError as StorageError)) {
          failures += 1;
          result.error = 'upload-failed';
          continue;
        }
        const args: AddPhotoArgs = {
          p_path: path,
          p_asset_id: asset.id,
          p_taken_at: new Date(taken).toISOString(),
          p_width: cleaned.width,
          p_height: cleaned.height,
        };
        const { error: rpcError } = await supabase.rpc(RPC.addPhoto, args);
        if (rpcError) {
          failures += 1;
          result.error = 'rpc-failed';
          continue;
        }
        done.push(asset.id);
        doneSet.add(asset.id);
        await writeJson(UPLOADED_KEY, done.slice(-KEEP_IDS));
        result.uploaded += 1;
      } finally {
        discard(cleaned.uri);
      }
    }
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }

  if (!result.error && result.uploaded === 0 && cleanFailures > 0) result.error = 'clean-failed';
  if (!result.error) await writeJson(JOB_LAST_OK_KEY.photos, now);
  return result;
}
