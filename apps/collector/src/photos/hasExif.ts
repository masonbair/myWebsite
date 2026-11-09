const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const XMP_HEADER = Array.from('http://ns.adobe.com/xap/1.0/\0', (c) => c.charCodeAt(0));

export type JpegInspection = 'clean' | 'metadata' | 'unparseable';

function startsWith(bytes: Uint8Array, at: number, header: number[]): boolean {
  return header.every((b, i) => bytes[at + i] === b);
}

/** 'clean' only for a well-formed JPEG that reaches its image data with no Exif or XMP block (either can hold GPS). */
export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 'unparseable';
  let at = 2;
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return 'unparseable';
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9) return 'unparseable';
    if (marker === 0x01 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return 'unparseable';
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) return 'unparseable';
    if (marker === 0xe1) {
      const payload = at + 4;
      if (startsWith(bytes, payload, EXIF_HEADER) || startsWith(bytes, payload, XMP_HEADER)) return 'metadata';
    }
    if (marker === 0xda) return 'clean';
    at += 2 + length;
  }
  return 'unparseable';
}

/** True when a JPEG carries an Exif or XMP block; false for anything else, including non-JPEG input. */
export function hasExif(bytes: Uint8Array): boolean {
  return inspectJpeg(bytes) === 'metadata';
}
