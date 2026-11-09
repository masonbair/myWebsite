import { readFileSync } from 'fs';
import { join } from 'path';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { cleanPhoto, ExifRemainsError } from '../cleanPhoto';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn() },
}));

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const manipulate = ImageManipulator.manipulate as jest.Mock;
const FileMock = File as unknown as jest.Mock;
const resize = jest.fn();
const saveAsync = jest.fn();
const bytes = jest.fn();
const del = jest.fn();

function image(width: number, height: number) {
  return { width, height, saveAsync };
}

function stage(source: { width: number; height: number }, resized = source) {
  const renders = [image(source.width, source.height), image(resized.width, resized.height)];
  manipulate.mockImplementation(() => ({
    resize: resize.mockReturnThis(),
    renderAsync: jest.fn(async () => renders.shift()),
  }));
}

beforeEach(() => {
  resize.mockReset();
  saveAsync.mockReset().mockImplementation(async () => ({ uri: 'file:///cache/out.jpg', width: 10, height: 6 }));
  bytes.mockReset().mockResolvedValue(fixture('no-exif.jpg'));
  del.mockReset();
  FileMock.mockReset().mockImplementation(() => ({ bytes, delete: del }));
});

describe('cleanPhoto', () => {
  it('re-encodes a small photo as JPEG at quality 0.85 without resizing', async () => {
    stage({ width: 1600, height: 1200 });
    const out = await cleanPhoto('file:///in.jpg');
    expect(resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ format: SaveFormat.JPEG, compress: 0.85 });
    expect(out).toEqual({ uri: 'file:///cache/out.jpg', width: 10, height: 6, bytes: fixture('no-exif.jpg') });
  });

  it('limits a landscape photo to 2400 px wide and a portrait one to 2400 px tall', async () => {
    stage({ width: 4000, height: 3000 }, { width: 2400, height: 1800 });
    await cleanPhoto('file:///in.jpg');
    expect(resize).toHaveBeenLastCalledWith({ width: 2400 });

    resize.mockClear();
    stage({ width: 3000, height: 4000 }, { width: 1800, height: 2400 });
    await cleanPhoto('file:///in.jpg');
    expect(resize).toHaveBeenLastCalledWith({ height: 2400 });
  });

  it('throws ExifRemainsError and deletes the file when metadata survives', async () => {
    stage({ width: 100, height: 100 });
    bytes.mockResolvedValue(fixture('with-gps.jpg'));
    await expect(cleanPhoto('file:///in.jpg')).rejects.toBeInstanceOf(ExifRemainsError);
    expect(del).toHaveBeenCalledTimes(1);
  });
});
