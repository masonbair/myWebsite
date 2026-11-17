import { anthropicClient } from "@/lib/ai/claude";
import { authorizedBody, fail, json } from "@/lib/hub/memo";
import { handleReport, sessionCapUsd, sessionReport, supabaseSessionStore } from "@/lib/hub/sessions";
import { serviceClient } from "@/lib/supabase/server";

// The laptop's Claude Code hook sends a bearer token, not a session cookie, so proxy.ts lets this path through as a machine API.
export async function POST(request: Request): Promise<Response> {
  const raw = await authorizedBody(request, process.env.HUB_AGENT_TOKEN, "session report");
  if (typeof raw !== "string") return raw;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "body is not JSON");
  }
  const parsed = sessionReport.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", parsed.error.issues[0]?.message ?? "bad report");
  try {
    const result = await handleReport(
      {
        store: supabaseSessionStore(serviceClient()),
        anthropic: anthropicClient("sessions"),
        capUsd: sessionCapUsd(process.env),
        now: () => new Date(),
      },
      parsed.data,
    );
    return json(200, result);
  } catch (e) {
    console.error(`session report ${parsed.data.event}: failed`, e instanceof Error ? e.message : e);
    return fail(502, "upstream", "could not save the report");
  }
}
