import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listTimeline, timelineWriter } from "@/lib/hub/timeline";

// Same gate as store.integration.test.ts: HUB_TEST_DB_URL=1 plus the local API URL and keys from `supabase status -o env`.
const enabled = Boolean(process.env.HUB_TEST_DB_URL);
const apiUrl = process.env.HUB_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.HUB_TEST_SERVICE_KEY ?? "";
const anonKey = process.env.HUB_TEST_ANON_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("HUB_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("timeline against local Supabase", () => {
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = () => createClient(apiUrl, serviceKey, options);
  const today = new Date().toISOString().slice(0, 10);

  it("sending a project again replaces its text for the day, and the audit log names the agent", async () => {
    const project = `it-${randomUUID().slice(0, 8)}`;
    const writer = timelineWriter(db(), { kind: "agent", client: "daily-log" });
    await writer.logDay({ day: today, projects: [{ project, summary: "Started the page.", commits: 2, branches: ["main"] }] });
    const [entry] = await writer.logDay({ day: today, projects: [{ project, summary: "Finished the page.", commits: 5, branches: ["main", "x"] }] });
    expect(entry).toMatchObject({ day: today, project, summary: "Finished the page.", commits: 5, branches: ["main", "x"] });

    const day = (await listTimeline(db())).find((d) => d.day === today);
    expect(day?.entries.filter((e) => e.project === project)).toHaveLength(1);
    const { data } = await db().from("audit_log").select("actor, action").eq("action", "timeline").contains("detail", { projects: [project] });
    expect(data).toEqual([
      { actor: "agent:daily-log", action: "timeline" },
      { actor: "agent:daily-log", action: "timeline" },
    ]);
  });

  it("the database refuses closed days and deletes, even for the service role", async () => {
    const project = `it-${randomUUID().slice(0, 8)}`;
    const old = await db().from("timeline_entries").insert({ day: "2020-01-01", project, summary: "x", updated_by: "test" });
    expect(old.error?.message).toMatch(/closed/);
    await db().from("timeline_entries").insert({ day: today, project, summary: "x", updated_by: "test" });
    const moved = await db().from("timeline_entries").update({ day: "2020-01-01" }).eq("project", project);
    expect(moved.error?.message).toMatch(/closed/);
    const removed = await db().from("timeline_entries").delete().eq("project", project);
    expect(removed.error?.message).toMatch(/permission denied|never deleted/);
  });

  it("someone not signed in sees nothing", async () => {
    const { data } = await createClient(apiUrl, anonKey, options).from("timeline_entries").select("*");
    expect(data ?? []).toEqual([]);
  });
});
