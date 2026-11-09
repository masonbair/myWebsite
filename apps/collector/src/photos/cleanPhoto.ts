import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { inspectJpeg } from './hasExif';

export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 0.85;

export class ExifRemainsError extends Error {
  constructor() {
    super('metadata remained after re-encoding');
    this.name = 'ExifRemainsError';
  }
}

export class UnreadableJpegError extends Error {
  constructor() {
    super('re-encoded file is not a well-formed JPEG');
    this.name = 'UnreadableJpegError';
  }
}

export type CleanPhoto = { uri: string; width: number; height: number; bytes: Uint8Array };

/** Re-encodes to a JPEG with no metadata and returns the exact bytes to upload; throws unless the output is provably clean. */
export async function cleanPhoto(uri: string): Promise<CleanPhoto> {
  const releasables: { release(): unknown }[] = [];
  let savedUri: string | null = null;
  try {
    const context = ImageManipulator.manipulate(uri);
    releasables.push(context);
    const loaded = await context.renderAsync();
    releasables.push(loaded);
    let image = loaded;
    if (Math.max(loaded.width, loaded.height) > MAX_EDGE) {
      // Resized from the already decoded image so the full-size photo is decoded once.
      const resizer = ImageManipulator.manipulate(loaded);
      releasables.push(resizer);
      image = await resizer.resize(loaded.width >= loaded.height ? { width: MAX_EDGE } : { height: MAX_EDGE }).renderAsync();
      releasables.push(image);
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    savedUri = saved.uri;
    const bytes = await new File(saved.uri).bytes();
    const inspection = inspectJpeg(bytes);
    if (inspection === 'metadata') throw new ExifRemainsError();
    if (inspection === 'unparseable') throw new UnreadableJpegError();
    const out = { uri: saved.uri, width: saved.width, height: saved.height, bytes };
    savedUri = null;
    return out;
  } catch (error) {
    if (savedUri) {
      try {
        new File(savedUri).delete();
      } catch {
        // The OS clears the cache directory anyway.
      }
    }
    throw error;
  } finally {
    for (const item of releasables) item.release();
  }
}
