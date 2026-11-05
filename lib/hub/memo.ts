import { tokenMatches } from "./bearer";
import type { HubStore, NewMemo } from "./types";

const MAX_BODY = 1_000_000;
// Kept from todo-hub, where Todoist capped comments near 16k characters.
const CHUNK = 15_000;

export const MEMO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECORDED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
export const TRANSCRIPT_PART = /^transcript \(part (\d+) of \d+\):\n/;

type Upload = { file: string; recorded: string; transcript: string; device: "phone" | "mac" };

export type MemoDeps = { token: string | undefined; store: HubStore };

const json = (status: number, body: unknown) => Response.json(body, { status });
const fail = (status: number, error: string, message: string) => json(status, { error, message });

function parseUpload(raw: string): Upload | string {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "body is not JSON";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body must be an object";
  const { file, recorded, transcript, device } = body as Partial<Record<keyof Upload, unknown>>;
  if (typeof file !== "string" || !MEMO_FILE.test(file)) return "file must be a plain device file name";
  if (typeof recorded !== "string" || !RECORDED.test(recorded)) return "recorded must be YYYY-MM-DDTHH:MM:SS";
  if (typeof transcript !== "string" || !transcript.trim()) return "transcript must be non-empty";
  if (device !== "phone" && device !== "mac") return 'device must be "phone" or "mac"';
  return { file, recorded, transcript, device };
}

/** The memo item's title and description, and its trimmed transcript cut into numbered comment parts. */
export function memoItem(m: { file: string; recorded: string; transcript: string }) {
  const text = m.transcript.trim();
  const parts = Math.max(1, Math.ceil(text.length / CHUNK));
  const transcriptParts: string[] = [];
  for (let n = 1; n <= parts; n++) {
    transcriptParts.push(`transcript (part ${n} of ${parts}):\n${text.slice((n - 1) * CHUNK, n * CHUNK)}`);
  }
  return {
    title: `HiDock memo ${m.file.replace(/\.[^.]*$/, "")}`,
    description: `Source: HiDock ${m.file}, recorded ${m.recorded}\nhidock-file: ${m.file}`,
    transcriptParts,
  };
}

/** HiDock memo upload: one `hidock-memo` inbox item per device file name, however often it is sent. */
export async function handleMemo(request: Request, deps: MemoDeps): Promise<Response> {
  if (!deps.token) return fail(503, "misconfigured", "memo upload is not configured");
  if (!tokenMatches(request.headers.get("authorization"), deps.token)) {
    return fail(401, "unauthorized", "bad or missing bearer token");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "too_large", "body over 1 MB");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY) return fail(413, "too_large", "body over 1 MB");
  const upload = parseUpload(raw);
  if (typeof upload === "string") return fail(400, "bad_request", upload);

  const memo: NewMemo = { file: upload.file, recorded: upload.recorded, device: upload.device, ...memoItem(upload) };
  try {
    const accepted = await deps.store.acceptMemo(memo);
    if (accepted.duplicate) return json(200, { duplicate: true, id: accepted.id });
    return json(201, { id: accepted.id });
  } catch (e) {
    console.error(`memo ${upload.file}: ${(e as Error).message}`);
    return fail(502, "upstream", "could not file the memo; retry later");
  }
}
