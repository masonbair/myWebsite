import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MAX_INPUT_PIXELS, cleanJpeg, servePhoto, type PhotoStore } from "@/lib/photo-server";

// Paris, a well-known public point, standing in for a location the phone failed to strip.
const GPS_EXIF = {
  IFD0: { ImageDescription: "GPS test" },
  IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 3/1" },
};
const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="48,51.4N"/></rdf:RDF></x:xmpmeta>';

async function jpegWithLocation(width = 64, height = 48): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg()
    .withExif(GPS_EXIF)
    .withXmp(XMP)
    .withIccProfile("p3")
    .toBuffer();
  return new Uint8Array(buf);
}

/** The APPn markers (0xE0-0xEF) a JPEG carries before its image data. */
function appMarkers(bytes: Uint8Array): { marker: number; head: string }[] {
  const found: { marker: number; head: string }[] = [];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xda) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xe0 && marker <= 0xef) found.push({ marker, head: Buffer.from(bytes.subarray(i + 4, i + 4 + 5)).toString("latin1") });
    i += 2 + length;
  }
  return found;
}

const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text, "latin1"));

function fakeStore(rows: Record<string, { hidden: boolean; bytes?: Uint8Array }>) {
  const downloads: string[] = [];
  const store: PhotoStore = {
    isHidden: vi.fn(async (id: string) => (id in rows ? rows[id].hidden : null)),
    download: vi.fn(async (path: string) => {
      downloads.push(path);
      const id = path.replace(/^collector\//, "").replace(/\.jpg$/, "");
      return rows[id]?.bytes ?? null;
    }),
  };
  return { store, downloads };
}

const PUBLIC = { includeHidden: false, cacheControl: "public, max-age=300, s-maxage=300" };

describe("servePhoto", () => {
  it("serves a visible photo with every APPn segment but JFIF removed, so no GPS EXIF, XMP or ICC survives", async () => {
    const input = await jpegWithLocation();
    expect(contains(input, "Exif\0\0")).toBe(true);
    expect(contains(input, "GPS")).toBe(true);
    const { store, downloads } = fakeStore({ abc: { hidden: false, bytes: input } });

    const res = await servePhoto("abc", null, { ...PUBLIC, store: () => store });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect(downloads).toEqual(["collector/abc.jpg"]);
    const out = new Uint8Array(await res.arrayBuffer());
    expect([out[0], out[1], out[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(contains(out, "Exif\0\0")).toBe(false);
    expect(contains(out, "GPS")).toBe(false);
    expect(contains(out, "ICC_PROFILE")).toBe(false);
    expect(contains(out, "ns.adobe.com")).toBe(false);
    expect(appMarkers(out).every((m) => m.marker === 0xe0 && m.head === "JFIF\0")).toBe(true);
    const meta = await sharp(Buffer.from(out)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it("serves only the four allowed widths, shrinking but never enlarging", async () => {
    const { store } = fakeStore({ big: { hidden: false, bytes: await jpegWithLocation(2000, 1000) }, small: { hidden: false, bytes: await jpegWithLocation() } });
    const width = async (id: string, w: string | null) =>
      (await sharp(Buffer.from(await (await servePhoto(id, w, { ...PUBLIC, store: () => store })).arrayBuffer())).metadata()).width;
    expect(await width("big", "640")).toBe(640);
    expect(await width("big", null)).toBe(1600);
    expect(await width("small", "1080")).toBe(64);
  });

  it("404s any other w with no cache and without touching the store, so cache keys cannot be sprayed", async () => {
    const { store } = fakeStore({ big: { hidden: false, bytes: await jpegWithLocation() } });
    for (const w of ["300", "99999", "0640", "640.0", "nope", "", "-640", "1e3", " 640"]) {
      const res = await servePhoto("big", w, { ...PUBLIC, store: () => store });
      expect(res.status, w).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(store.isHidden).not.toHaveBeenCalled();
  });

  it("refuses an image over the pixel limit instead of decoding it", async () => {
    expect(MAX_INPUT_PIXELS).toBe(50_000_000);
    // 8000 x 7000 = 56 MP, just over the limit; a flat color keeps the file tiny.
    const huge = new Uint8Array(await sharp({ create: { width: 8000, height: 7000, channels: 3, background: "gray" } }).jpeg().toBuffer());
    await expect(cleanJpeg(huge, 256)).rejects.toThrow(/pixel limit/i);
    const { store } = fakeStore({ huge: { hidden: false, bytes: huge } });
    expect((await servePhoto("huge", "256", { ...PUBLIC, store: () => store })).status).toBe(404);
  });

  it("refuses ids that could leave collector/ before touching the database", async () => {
    const { store } = fakeStore({});
    for (const id of ["../secret", "..", "a/b", "a.jpg", "a%2F..", "", "a b", "x".repeat(201)]) {
      const res = await servePhoto(id, null, { ...PUBLIC, store: () => store });
      expect(res.status, id).toBe(404);
    }
    expect(store.isHidden).not.toHaveBeenCalled();
    expect(store.download).not.toHaveBeenCalled();
  });

  it("404s a hidden or unknown photo without downloading it, and with no cache", async () => {
    const { store } = fakeStore({ gone: { hidden: true, bytes: await jpegWithLocation() } });
    for (const id of ["gone", "unknown"]) {
      const res = await servePhoto(id, null, { ...PUBLIC, store: () => store });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(store.download).not.toHaveBeenCalled();
  });

  it("serves a hidden photo only when includeHidden (the hub's thumbnails)", async () => {
    const { store } = fakeStore({ gone: { hidden: true, bytes: await jpegWithLocation() } });
    const res = await servePhoto("gone", "256", { includeHidden: true, cacheControl: "private, max-age=300", store: () => store });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("refuses stored bytes that are not a JPEG, and a JPEG start that is not a real image", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer());
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 1, 2, 3]);
    const { store } = fakeStore({ png: { hidden: false, bytes: png }, fake: { hidden: false, bytes: fakeJpeg }, missing: { hidden: false } });
    for (const id of ["png", "fake", "missing"]) {
      expect((await servePhoto(id, null, { ...PUBLIC, store: () => store })).status, id).toBe(404);
    }
  });

  it("answers 503 when the database cannot be reached or is not configured", async () => {
    const failing: PhotoStore = { isHidden: async () => Promise.reject(new Error("down")), download: async () => null };
    expect((await servePhoto("abc", null, { ...PUBLIC, store: () => failing })).status).toBe(503);
    const noEnv = () => {
      throw new Error("SUPABASE_URL is not set");
    };
    expect((await servePhoto("abc", null, { ...PUBLIC, store: noEnv })).status).toBe(503);
  });
});
