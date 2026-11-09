const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const XMP_HEADER = Array.from('http://ns.adobe.com/xap/1.0/\0', (c) => c.charCodeAt(0));

function startsWith(bytes: Uint8Array, at: number, header: number[]): boolean {
  return header.every((b, i) => bytes[at + i] === b);
}

/** True when a JPEG carries an Exif or XMP block (either can hold GPS); stops at the image data. */
export function hasExif(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return false;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return false;
    if (marker === 0xe1) {
      const payload = at + 4;
      if (startsWith(bytes, payload, EXIF_HEADER) || startsWith(bytes, payload, XMP_HEADER)) return true;
    }
    at += 2 + length;
  }
  return false;
}
