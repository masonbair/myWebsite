import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizedBody, fail, json, parseRecording, type Recording } from "@/lib/hub/memo";

export type RecordingDeps = {
  token: string | undefined;
  /** Saves the recording once per file name; a resend changes nothing. */
  insert: (recording: Recording) => Promise<"created" | "duplicate">;
};

/** The Mac's read-only HiNote intake: one idea_recordings row per file name, and nothing else written. */
export async function handleRecording(request: Request, deps: RecordingDeps): Promise<Response> {
  const raw = await authorizedBody(request, deps.token, "recording upload");
  if (typeof raw !== "string") return raw;
  const parsed = parseRecording(raw);
  if (typeof parsed === "string") return fail(400, "bad_request", parsed);
  const { recording } = parsed;
  try {
    const status = await deps.insert(recording);
    return json(status === "created" ? 201 : 200, { status });
  } catch {
    console.error(`recording ${recording.file}: not saved`);
    return fail(502, "upstream", "could not save the recording; retry later");
  }
}

/** Inserts with `on conflict (file) do nothing`, so the first copy of a file always wins. */
export async function insertRecording(client: SupabaseClient, recording: Recording): Promise<"created" | "duplicate"> {
  const { data, error } = await client
    .from("idea_recordings")
    .upsert(recording, { onConflict: "file", ignoreDuplicates: true })
    .select("file");
  if (error) throw error;
  return (data ?? []).length > 0 ? "created" : "duplicate";
}
