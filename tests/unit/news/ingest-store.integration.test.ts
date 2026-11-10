import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createIngestDeps } from "@/lib/news/ingest-store";
import type { NewIssue } from "@/lib/news/types";

// Run with: NEWS_TEST_DB=1 NEWS_TEST_SUPABASE_URL=http://127.0.0.1:55321 NEWS_TEST_SERVICE_KEY=<SERVICE_ROLE_KEY> (from `supabase status -o env`)
// Refuses to load unless the API URL is local, because test rows can never be deleted.
const enabled = Boolean(process.env.NEWS_TEST_DB);
const apiUrl = process.env.NEWS_TEST_SUPABASE_URL ?? "";
const serviceKey = process.env.NEWS_TEST_SERVICE_KEY ?? "";
if (enabled && !/^(127\.0\.0\.1|localhost)$/.test(new URL(apiUrl || "http://invalid").hostname)) {
  throw new Error("NEWS_TEST_SUPABASE_URL must be a local Supabase (127.0.0.1 or localhost)");
}

describe.skipIf(!enabled)("news ingest store against local Supabase", () => {
  const client = () => createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const deps = () => createIngestDeps(client(), async () => {}, "America/New_York");
  const row = (messageId: string): NewIssue => ({
    sourceId: null,
    messageId,
    subject: "integration",
    fromAddress: "a@example.test",
    receivedAt: "2026-11-09T02:30:00.000Z",
    publishedOn: "2026-11-08",
    rawPath: "news/raw/2026/11/x.eml",
    cleanText: "synthetic",
    publicUrl: null,
    status: "quarantined",
    lastError: "parse failed",
  });

  it("lists only active sources, mapped to camelCase", async () => {
    const id = `it-${randomUUID().slice(0, 8)}`;
    const { error } = await client().from("news_sources").insert([
      { id, name: "Active", sender_domains: ["active.example.test"], homepage: "https://active.example.test/", active: true },
      { id: `${id}-off`, name: "Off", sender_domains: ["off.example.test"], active: false },
    ]);
    if (error) throw error;
    const sources = await deps().sources();
    const mine = sources.find((s) => s.id === id);
    expect(mine).toMatchObject({ name: "Active", senderDomains: ["active.example.test"], homepage: "https://active.example.test/", archivePattern: null, active: true });
    expect(sources.some((s) => s.id === `${id}-off`)).toBe(false);
  });

  it("inserts once, returns null on the same message id, and finds the id", async () => {
    const messageId = `<${randomUUID()}@example.test>`;
    const first = await deps().insertIssue(row(messageId));
    expect(first?.id).toBeTruthy();
    expect(await deps().insertIssue(row(messageId))).toBeNull();
    expect(await deps().findIssueId(messageId)).toBe(first?.id);
    const { data } = await client().from("news_issues").select("last_error").eq("id", first?.id).single();
    expect(data?.last_error).toBe("parse failed");
    expect(await deps().findIssueId(`<${randomUUID()}@example.test>`)).toBeNull();
  });
});
