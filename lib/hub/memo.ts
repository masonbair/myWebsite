import { tokenMatches } from "./bearer";
import type { HubStore, NewMemo } from "./types";

const MAX_BODY = 1_000_000;
// Kept from todo-hub, where Todoist capped comments near 16k characters.
const CHUNK = 15_000;

export const MEMO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECORDED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
export const TRANSCRIPT_PART = /^transcript \(part (\d+) of \d+\):\n/;

/** One transcript as an uploader sends it: a plain file name, a local time and the text. */
export type Recording = { file: string; recorded: string; transcript: string };
type Upload = Recording & { device: "phone" | "mac" };

export type MemoDeps = {
  token: string | undefined;
  store: HubStore;
  /** IDEAS_MEMO_DETECTION=on; off, the relay does exactly what it did before the Ideas Lab. */
  memoDetection?: boolean;
  /** Queues a new memo item for the Ideas Lab's detection step. */
  queueIdeas?: (itemId: string) => Promise<void>;
};

export const json = (status: number, body: unknown) => Response.json(body, { status });
export const fail = (status: number, error: string, message: string) => json(status, { error, message });

// Date rolls 2026-02-30 over to March 2, so a real time must come back unchanged.
export function isRealTime(recorded: string): boolean {
  const time = new Date(`${recorded}Z`);
  return !Number.isNaN(time.getTime()) && time.toISOString().slice(0, 19) === recorded;
}

/** How an uploader's `recorded` must look: the memo relay takes local time with no offset. */
export type TimeShape = { valid: (recorded: string) => boolean; shape: string };

const LOCAL_TIME: TimeShape = {
  valid: (recorded) => RECORDED.test(recorded) && isRealTime(recorded),
  shape: "YYYY-MM-DDTHH:MM:SS",
};

/**
 * Checks an upload's JSON body for a plain file name, a real time and a non-empty transcript; a string says what is wrong.
 * @param time the shape `recorded` must have; local time with no offset unless given.
 */
export function parseRecording(raw: string, time: TimeShape = LOCAL_TIME): { recording: Recording; body: Record<string, unknown> } | string {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "body is not JSON";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body must be an object";
  const { file, recorded, transcript } = body as Partial<Record<keyof Recording, unknown>>;
  if (typeof file !== "string" || !MEMO_FILE.test(file)) return "file must be a plain device file name";
  if (typeof recorded !== "string" || !time.valid(recorded)) {
    return `recorded must be a real ${time.shape}`;
  }
  if (typeof transcript !== "string" || !transcript.trim()) return "transcript must be non-empty";
  return { recording: { file, recorded, transcript }, body: body as Record<string, unknown> };
}

function parseUpload(raw: string): Upload | string {
  const parsed = parseRecording(raw);
  if (typeof parsed === "string") return parsed;
  const { device } = parsed.body;
  if (device !== "phone" && device !== "mac") return 'device must be "phone" or "mac"';
  return { ...parsed.recording, device };
}

/**
 * The raw body once the bearer token and the 1 MB cap pass, or the error reply.
 * @param what names the upload in the 503 reply when its token is not configured.
 */
export async function authorizedBody(request: Request, token: string | undefined, what: string): Promise<string | Response> {
  if (!token) return fail(503, "misconfigured", `${what} is not configured`);
  if (!tokenMatches(request.headers.get("authorization"), token)) {
    return fail(401, "unauthorized", "bad or missing bearer token");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "too_large", "body over 1 MB");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY) return fail(413, "too_large", "body over 1 MB");
  return raw;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** The memo item's title and description, and its trimmed transcript cut into numbered comment parts. */
export function memoItem(m: { file: string; recorded: string; transcript: string }) {
  const text = m.transcript.trim();
  const chunks: string[] = [];
  for (let start = 0; start < text.length || chunks.length === 0; ) {
    let end = Math.min(start + CHUNK, text.length);
    // Never cut between the two halves of a surrogate pair (an emoji, say).
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  const transcriptParts = chunks.map((chunk, i) => `transcript (part ${i + 1} of ${chunks.length}):\n${chunk}`);
  return {
    title: `HiDock memo ${m.file.replace(/\.[^.]*$/, "")}`,
    description: `Source: HiDock ${m.file}, recorded ${m.recorded}\nhidock-file: ${m.file}`,
    transcriptParts,
  };
}

// The memo is already filed; a lost detection row only costs its ideas, never the memo, so the upload still succeeds.
async function queueIdeas(queue: (itemId: string) => Promise<void>, itemId: string): Promise<void> {
  try {
    await queue(itemId);
  } catch {
    console.error(`memo ${itemId}: ideas detection not queued`);
  }
}

/** HiDock memo upload: one `hidock-memo` inbox item per device file name, however often it is sent. */
export async function handleMemo(request: Request, deps: MemoDeps): Promise<Response> {
  const raw = await authorizedBody(request, deps.token, "memo upload");
  if (typeof raw !== "string") return raw;
  const upload = parseUpload(raw);
  if (typeof upload === "string") return fail(400, "bad_request", upload);

  const memo: NewMemo = { file: upload.file, recorded: upload.recorded, device: upload.device, ...memoItem(upload) };
  try {
    const accepted = await deps.store.acceptMemo(memo);
    // status and taskId keep todo-hub's reply, which the HiDock uploaders on the phone and Mac check.
    if (accepted.duplicate) return json(200, { status: "duplicate", duplicate: true, id: accepted.id, taskId: accepted.id });
    if (deps.memoDetection && deps.queueIdeas && accepted.id) await queueIdeas(deps.queueIdeas, accepted.id);
    return json(201, { status: "created", id: accepted.id, taskId: accepted.id });
  } catch (e) {
    console.error(`memo ${upload.file}: ${(e as Error).message}`);
    return fail(502, "upstream", "could not file the memo; retry later");
  }
}
