import { Directory, File } from 'expo-file-system';
import { BUCKET, RPC, daylioPath, type AddDaylioExportArgs } from '../../../../shared/collector-contract';
import { readJson, writeJson } from '../lib/store';
import { DAYLIO_FOLDER_KEY } from '../lib/storageKeys';
import { signedIn, supabase } from '../lib/supabase';

export type DaylioJobResult = { uploaded: number; skipped: number; error: string | null };

const UPLOADED_KEY = 'daylio-uploaded';
// Matches the 25 MB limit on the daylio bucket.
const MAX_BYTES = 25 * 1024 * 1024;
const KEEP_KEYS = 500;
const MAX_FAILURES_PER_RUN = 3;

type StorageError = { message?: string; statusCode?: string | number };

function isDuplicate(error: StorageError): boolean {
  return String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message ?? '');
}

function contentType(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.daylio')) return 'application/octet-stream';
  return null;
}

/** Asks Android for a folder; the grant is kept across restarts. False if the person backs out. */
export async function pickDaylioFolder(): Promise<boolean> {
  try {
    const folder = await Directory.pickDirectoryAsync();
    await writeJson(DAYLIO_FOLDER_KEY, folder.uri);
    return true;
  } catch {
    return false;
  }
}

/** Uploads new or changed Daylio exports (.csv, .daylio, up to 25 MB) from the picked folder. */
export async function runDaylioJob(): Promise<DaylioJobResult> {
  const result: DaylioJobResult = { uploaded: 0, skipped: 0, error: null };
  if (!(await signedIn())) return { ...result, error: 'signed-out' };

  const folderUri = await readJson<string | null>(DAYLIO_FOLDER_KEY, null);
  if (!folderUri) return { ...result, error: 'no-folder' };

  let entries: (File | Directory)[];
  try {
    entries = new Directory(folderUri).list();
  } catch {
    return { ...result, error: 'folder-access-lost' };
  }

  const done = await readJson<string[]>(UPLOADED_KEY, []);
  const doneSet = new Set(done);
  let failures = 0;

  for (const entry of entries) {
    if (failures >= MAX_FAILURES_PER_RUN) break;
    if (!(entry instanceof File)) continue;
    const type = contentType(entry.name);
    if (!type) continue;

    const size = entry.size;
    const modifiedMs = entry.modificationTime === null ? null : Math.trunc(entry.modificationTime);
    if (!(size > 0) || size > MAX_BYTES || modifiedMs === null || modifiedMs <= 0) {
      result.skipped += 1;
      continue;
    }
    const key = `${entry.name}|${size}|${modifiedMs}`;
    if (doneSet.has(key)) continue;

    try {
      const path = daylioPath(entry.name, size, modifiedMs);
      const { error: uploadError } = await supabase.storage
        .from(BUCKET.daylio)
        .upload(path, await entry.bytes(), { contentType: type, upsert: false });
      if (uploadError && !isDuplicate(uploadError as StorageError)) {
        failures += 1;
        result.error = 'upload-failed';
        continue;
      }
      const args: AddDaylioExportArgs = {
        p_path: path,
        p_filename: entry.name,
        p_size_bytes: size,
        p_modified_at: new Date(modifiedMs).toISOString(),
      };
      const { error: rpcError } = await supabase.rpc(RPC.addDaylioExport, args);
      if (rpcError) {
        failures += 1;
        result.error = 'rpc-failed';
        continue;
      }
      done.push(key);
      doneSet.add(key);
      await writeJson(UPLOADED_KEY, done.slice(-KEEP_KEYS));
      result.uploaded += 1;
    } catch {
      failures += 1;
      result.error = 'upload-failed';
    }
  }
  return result;
}
