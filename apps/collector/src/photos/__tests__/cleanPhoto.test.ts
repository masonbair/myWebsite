import { readFileSync } from 'fs';
import { join } from 'path';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { cleanPhoto, ExifRemainsError, UnreadableJpegError } from '../cleanPhoto';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn() },
}));

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const manipulate = ImageManipulator.manipulate as jest.Mock;
const FileMock = File as unknown as jest.Mock;
const bytes = jest.fn();
const del = jest.fn();
const release = jest.fn();
const resize = jest.fn();
let loaded: ReturnType<typeof makeImage>;
let resized: ReturnType<typeof makeImage>;

function makeImage(width: number, height: number, uri: string) {
  return {
    width,
    height,
    release,
    saveAsync: jest.fn(async () => ({ uri, width: width > 0 ? width : 0, height })),
  };
}

function stage(source: [number, number], target?: [number, number]) {
  loaded = makeImage(source[0], source[1], 'file:///cache/loaded.jpg');
  resized = makeImage(target?.[0] ?? 0, target?.[1] ?? 0, 'file:///cache/resized.jpg');
  manipulate.mockImplementation((input: unknown) => ({
    release,
    resize: resize.mockImplementation(() => ({ release, renderAsync: async () => resized })),
    renderAsync: async () => (typeof input === 'string' ? loaded : resized),
  }));
}

beforeEach(() => {
  manipulate.mockReset();
  resize.mockReset();
  release.mockReset();
  bytes.mockReset().mockResolvedValue(fixture('no-exif.jpg'));
  del.mockReset();
  FileMock.mockReset().mockImplementation(() => ({ bytes, delete: del }));
});

describe('cleanPhoto', () => {
  it('re-encodes a small photo as JPEG at quality 0.85 without resizing', async () => {
    stage([1600, 1200]);
    const out = await cleanPhoto('file:///in.jpg');
    expect(resize).not.toHaveBeenCalled();
    expect(loaded.saveAsync).toHaveBeenCalledWith({ format: SaveFormat.JPEG, compress: 0.85 });
    expect(out).toEqual({ uri: 'file:///cache/loaded.jpg', width: 1600, height: 1200, bytes: fixture('no-exif.jpg') });
  });

  it('decodes the original once and saves the resized image, 2400 wide for landscape and tall for portrait', async () => {
    stage([4000, 3000], [2400, 1800]);
    const out = await cleanPhoto('file:///in.jpg');
    expect(resize).toHaveBeenLastCalledWith({ width: 2400 });
    expect(manipulate.mock.calls[0][0]).toBe('file:///in.jpg');
    expect(manipulate.mock.calls[1][0]).toBe(loaded);
    expect(loaded.saveAsync).not.toHaveBeenCalled();
    expect(resized.saveAsync).toHaveBeenCalledTimes(1);
    expect(out.uri).toBe('file:///cache/resized.jpg');

    stage([3000, 4000], [1800, 2400]);
    await cleanPhoto('file:///in.jpg');
    expect(resize).toHaveBeenLastCalledWith({ height: 2400 });
  });

  it('releases every image and context, also after a failure', async () => {
    stage([4000, 3000], [2400, 1800]);
    await cleanPhoto('file:///in.jpg');
    expect(release).toHaveBeenCalledTimes(4);

    release.mockClear();
    stage([100, 100]);
    bytes.mockResolvedValue(fixture('with-gps.jpg'));
    await expect(cleanPhoto('file:///in.jpg')).rejects.toBeInstanceOf(ExifRemainsError);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('throws ExifRemainsError and deletes the file when metadata survives', async () => {
    stage([100, 100]);
    bytes.mockResolvedValue(fixture('with-gps.jpg'));
    await expect(cleanPhoto('file:///in.jpg')).rejects.toBeInstanceOf(ExifRemainsError);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('refuses truncated output and non-JPEG output, deleting the file', async () => {
    stage([100, 100]);
    bytes.mockResolvedValue(fixture('no-exif.jpg').slice(0, 40));
    await expect(cleanPhoto('file:///in.jpg')).rejects.toBeInstanceOf(UnreadableJpegError);
    bytes.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await expect(cleanPhoto('file:///in.jpg')).rejects.toBeInstanceOf(UnreadableJpegError);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('deletes the saved file when reading it fails', async () => {
    stage([100, 100]);
    bytes.mockRejectedValue(new Error('read failed'));
    await expect(cleanPhoto('file:///in.jpg')).rejects.toThrow('read failed');
    expect(del).toHaveBeenCalledTimes(1);
  });
});
