import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { ASSET_ID, DEFAULT_PHOTO_WIDTH, snapPhotoWidth } from "@/lib/collector-photos";
import { BUCKET, PHOTO_PREFIX } from "@/shared/collector-contract";

/** How the photo routes reach the database and storage; tests pass a fake. */
export type PhotoStore = {
  /** null when no row has this asset id. */
  isHidden(assetId: string): Promise<boolean | null>;
  /** null when the object is missing or cannot be read. */
  download(path: string): Promise<Uint8Array | null>;
};

export function supabasePhotoStore(client: SupabaseClient): PhotoStore {
  return {
    async isHidden(assetId) {
      const { data, error } = await client.from("collector_photo").select("hidden").eq("asset_id", assetId).maybeSingle();
      if (error) throw error;
      return data ? data.hidden === true : null;
    },
    async download(path) {
      const { data, error } = await client.storage.from(BUCKET.photos).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Re-encodes a JPEG no wider or taller than maxEdge; sharp drops all EXIF, XMP, IPTC and ICC data unless asked to keep it. */
export async function cleanJpeg(input: Uint8Array, maxEdge: number): Promise<Uint8Array> {
  const out = await sharp(input, { failOn: "error" })
    // Applies the EXIF orientation to the pixels first, since the orientation tag is dropped with the rest.
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(out);
}

type ServeOptions = { store: () => PhotoStore; includeHidden: boolean; cacheControl: string };

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** A photo the phone uploaded, cleaned and resized, or 404 for a bad id, a hidden photo (unless includeHidden), or bytes that are not a JPEG. */
export async function servePhoto(assetId: string, widthParam: string | null, options: ServeOptions): Promise<Response> {
  if (!ASSET_ID.test(assetId)) return notFound();
  const asked = Number(widthParam);
  const width = widthParam !== null && Number.isInteger(asked) && asked > 0 ? snapPhotoWidth(asked) : DEFAULT_PHOTO_WIDTH;
  let store: PhotoStore;
  let hidden: boolean | null;
  try {
    store = options.store();
    hidden = await store.isHidden(assetId);
  } catch {
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (hidden === null || (hidden && !options.includeHidden)) return notFound();
  const bytes = await store.download(`${PHOTO_PREFIX}${assetId}.jpg`).catch(() => null);
  if (!bytes || !isJpeg(bytes)) return notFound();
  let clean: Uint8Array;
  try {
    clean = await cleanJpeg(bytes, width);
  } catch {
    return notFound();
  }
  return new Response(clean as BodyInit, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(clean.byteLength),
      "Cache-Control": options.cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
