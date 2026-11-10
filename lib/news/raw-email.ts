import "server-only";
import { get } from "@vercel/blob";
import { parseEmail, type ParsedEmail } from "./email";

const MAX_RAW_BYTES = 10_000_000;

/** Reads and parses a stored raw email from the private blob store; null when it is missing or unreadable. */
export async function loadRawEmail(rawPath: string): Promise<ParsedEmail | null> {
  if (!rawPath) return null;
  try {
    const blob = await get(rawPath, { access: "private" });
    if (!blob || blob.statusCode !== 200 || blob.blob.size > MAX_RAW_BYTES) return null;
    return await parseEmail(new Uint8Array(await new Response(blob.stream).arrayBuffer()));
  } catch {
    return null;
  }
}
