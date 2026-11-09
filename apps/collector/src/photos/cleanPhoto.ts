import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { hasExif } from './hasExif';

export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 0.85;

export class ExifRemainsError extends Error {
  constructor() {
    super('metadata remained after re-encoding');
    this.name = 'ExifRemainsError';
  }
}

export type CleanPhoto = { uri: string; width: number; height: number; bytes: Uint8Array };

/** Re-encodes to a JPEG with no metadata and returns the exact bytes to upload; throws if any metadata survives. */
export async function cleanPhoto(uri: string): Promise<CleanPhoto> {
  const probe = await ImageManipulator.manipulate(uri).renderAsync();
  const longEdge = Math.max(probe.width, probe.height);
  const image =
    longEdge > MAX_EDGE
      ? await ImageManipulator.manipulate(uri)
          .resize(probe.width >= probe.height ? { width: MAX_EDGE } : { height: MAX_EDGE })
          .renderAsync()
      : probe;
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  const file = new File(saved.uri);
  const bytes = await file.bytes();
  if (hasExif(bytes)) {
    file.delete();
    throw new ExifRemainsError();
  }
  return { uri: saved.uri, width: saved.width, height: saved.height, bytes };
}
