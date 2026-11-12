import { tokenMatches } from "@/lib/hub/bearer";
import { readCappedBody } from "@/lib/hub/capped-body";
import { isCalendarDate } from "@/lib/hub/input";
import { learnToday } from "./day";
import type { LearnStore } from "./store";
import { HUB_LEARN_URL, TOPIC_NAMES } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRANSCRIPT_BODY = 100_000;
const MAX_TRANSCRIPT_CHARS = 20_000;
const CLIP_URL_SECONDS = 600;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Null when the caller may go on; otherwise the 503 or 401 to send. */
function refuse(request: Request, token: string | undefined): Response | null {
  if (!token) return json({ error: "not configured" }, 503);
  if (!tokenMatches(request.headers.get("authorization"), token)) return json({ error: "unauthorized" }, 401);
  return null;
}

/** Focus Lock's poll: the signed grants stored for exactly one date, nothing else. */
export async function handleGrants(request: Request, deps: { token: string | undefined; store: LearnStore }): Promise<Response> {
  const refused = refuse(request, deps.token);
  if (refused) return refused;
  const dates = new URL(request.url).searchParams.getAll("date");
  if (dates.length !== 1 || !isCalendarDate(dates[0])) return json({ error: "date must be one YYYY-MM-DD" }, 400);
  return json({ grants: await deps.store.grantsFor(dates[0]) });
}

/** The Daily Learn routine's read: today's questions and readings, with no ids, clients or answers. */
export async function handleToday(
  request: Request,
  deps: { token: string | undefined; store: LearnStore; now: () => Date; timeZone: string },
): Promise<Response> {
  const refused = refuse(request, deps.token);
  if (refused) return refused;
  const date = learnToday(deps.now(), deps.timeZone);
  const exercises = await deps.store.exercisesFor(date);
  return json({
    date,
    hubUrl: HUB_LEARN_URL,
    exercises: exercises.map((e) => ({
      type: e.type,
      topic: TOPIC_NAMES[e.topic],
      question: e.question,
      reading: { title: e.readingTitle, url: e.readingUrl },
    })),
  });
}

/** hinote-sync's poll: voice clips still waiting for a transcript, each with a 10-minute download link. */
export async function handlePending(request: Request, deps: { token: string | undefined; store: LearnStore }): Promise<Response> {
  const refused = refuse(request, deps.token);
  if (refused) return refused;
  const pending = await deps.store.pendingClips();
  const clips = await Promise.all(pending.map(async (c) => ({ id: c.id, url: await deps.store.clipUrl(c.path, CLIP_URL_SECONDS), mime: c.mime })));
  return json({ clips });
}

/** hinote-sync's reply: attaches a transcript once (an empty one counts) and has grading run after the response. */
export async function handleTranscript(
  request: Request,
  id: string,
  deps: { token: string | undefined; store: LearnStore; schedule: (answerId: string) => void },
): Promise<Response> {
  const refused = refuse(request, deps.token);
  if (refused) return refused;
  if (!UUID.test(id)) return json({ error: "not found" }, 404);

  const bytes = await readCappedBody(request, MAX_TRANSCRIPT_BODY);
  if (!bytes) return json({ error: "body too large" }, 400);
  let transcript: unknown;
  try {
    transcript = (JSON.parse(new TextDecoder().decode(bytes)) as { transcript?: unknown } | null)?.transcript;
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  if (typeof transcript !== "string" || transcript.length > MAX_TRANSCRIPT_CHARS) {
    return json({ error: "transcript must be a string of at most 20000 characters" }, 400);
  }

  const result = await deps.store.attachTranscript(id, transcript);
  if (result === "missing") return json({ error: "not found" }, 404);
  if (result === "duplicate") return json({ error: "already transcribed" }, 409);
  deps.schedule(id);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
