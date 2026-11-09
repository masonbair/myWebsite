import { readFileSync } from 'fs';
import { join } from 'path';
import { hasExif, inspectJpeg } from '../hasExif';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function withApp1(payload: number[]): Uint8Array {
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...payload, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

describe('hasExif', () => {
  it('finds the Exif block (with GPS) in with-gps.jpg', () => {
    expect(hasExif(fixture('with-gps.jpg'))).toBe(true);
  });

  it('is false for a JPEG with no metadata', () => {
    expect(hasExif(fixture('no-exif.jpg'))).toBe(false);
  });

  it('is false for random bytes and empty input', () => {
    expect(hasExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(false);
    expect(hasExif(new Uint8Array())).toBe(false);
  });

  it('treats an XMP block as metadata', () => {
    expect(hasExif(withApp1([...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]))).toBe(true);
  });

  it('ignores other APP1 blocks and an Exif header after the image data starts', () => {
    expect(hasExif(withApp1(ascii('Other\0data')))).toBe(false);
    const late = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xe1, 0, 10, ...ascii('Exif'), 0, 0]);
    expect(hasExif(late)).toBe(false);
  });

  it('does not run past a truncated segment', () => {
    expect(hasExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]))).toBe(false);
  });
});

describe('inspectJpeg', () => {
  it('is clean only for a well-formed JPEG that reaches its image data', () => {
    expect(inspectJpeg(fixture('no-exif.jpg'))).toBe('clean');
    expect(inspectJpeg(fixture('with-gps.jpg'))).toBe('metadata');
  });

  it('is unparseable for truncated, non-JPEG and empty input', () => {
    expect(inspectJpeg(fixture('no-exif.jpg').slice(0, 40))).toBe('unparseable');
    expect(inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('unparseable');
    expect(inspectJpeg(new Uint8Array())).toBe('unparseable');
  });
});
