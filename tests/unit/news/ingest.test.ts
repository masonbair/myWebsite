import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseEmail, type ParsedEmail } from "@/lib/news/email";
import { ingestEmail, publicIssueUrl, type IngestDeps } from "@/lib/news/ingest";
import type { NewIssue, NewsSource } from "@/lib/news/types";

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const brew: NewsSource = {
  id: "brew",
  name: "Daily Brew",
  senderAddresses: [],
  senderDomains: ["example-brew.test"],
  homepage: "https://www.example-brew.test/",
  archivePattern: "https://www.example-brew.test/archive/{slug}",
  public: true,
  active: true,
};

function fakeDeps() {
  const rows = new Map<string, NewIssue & { id: string }>();
  const putRaw: string[] = [];
  const deps: IngestDeps = {
    sources: async () => [brew],
    putRaw: async (path) => void putRaw.push(path),
    insertIssue: async (row) => {
      if (rows.has(row.messageId)) return null;
      const id = `id-${rows.size + 1}`;
      rows.set(row.messageId, { ...row, id });
      return { id };
    },
    findIssueId: async (m) => rows.get(m)?.id ?? null,
    timeZone: "America/New_York",
  };
  return { deps, rows, putRaw };
}

const webhook = (forwardedOk = true, dkimFrom: string | null = "news@example-brew.test") => ({ kind: "webhook" as const, forwardedOk, dkimFrom });

describe("ingestEmail", () => {
  it("creates then reports a duplicate, storing raw once", async () => {
    const { deps, putRaw } = fakeDeps();
    const raw = load("issue.eml");
    const first = await ingestEmail(raw, deps, webhook());
    const second = await ingestEmail(raw, deps, webhook());
    expect(first.status).toBe("created");
    expect(second).toMatchObject({ status: "duplicate", id: first.id, issueStatus: "pending" });
    expect(putRaw).toHaveLength(1);
    expect(putRaw[0]).toMatch(/^news\/raw\/2026\/11\/[0-9a-f]{64}\.eml$/);
  });

  it("stores the row with local publish day and public url", async () => {
    const { deps, rows } = fakeDeps();
    await ingestEmail(load("issue.eml"), deps, webhook());
    const row = [...rows.values()][0];
    expect(row.publishedOn).toBe("2026-11-08");
    expect(row.sourceId).toBe("brew");
    expect(row.publicUrl).toBe("https://www.example-brew.test/archive/markets-wobble");
  });

  it("quarantines the Gmail confirmation, with no source", async () => {
    const { deps, rows, putRaw } = fakeDeps();
    const result = await ingestEmail(load("gmail-confirm.eml"), deps, webhook());
    expect(result.issueStatus).toBe("quarantined");
    expect([...rows.values()][0].sourceId).toBeNull();
    expect(putRaw).toHaveLength(1);
  });

  it("quarantines when DKIM or forwarding checks fail", async () => {
    expect((await ingestEmail(load("issue.eml"), fakeDeps().deps, webhook(true, null))).issueStatus).toBe("quarantined");
    expect((await ingestEmail(load("issue.eml"), fakeDeps().deps, webhook(true, "news@other-brew.test"))).issueStatus).toBe("quarantined");
    expect((await ingestEmail(load("issue.eml"), fakeDeps().deps, webhook(false))).issueStatus).toBe("quarantined");
    expect((await ingestEmail(load("issue.eml"), fakeDeps().deps, webhook())).issueStatus).toBe("pending");
  });

  it("backfill is backfill with a source, quarantined without", async () => {
    expect((await ingestEmail(load("issue.eml"), fakeDeps().deps, { kind: "backfill" })).issueStatus).toBe("backfill");
    expect((await ingestEmail(load("plain.eml"), fakeDeps().deps, { kind: "backfill" })).issueStatus).toBe("quarantined");
  });
});

describe("ingestEmail resilience", () => {
  it("stores garbage bytes as a quarantined row with raw saved", async () => {
    const { deps, rows, putRaw } = fakeDeps();
    vi.spyOn(await import("@/lib/news/email"), "parseEmail").mockRejectedValueOnce(new Error("boom"));
    const result = await ingestEmail(new Uint8Array([0, 1, 2, 255]), deps, webhook());
    const row = [...rows.values()][0];
    expect(result).toMatchObject({ status: "created", issueStatus: "quarantined" });
    expect(row.messageId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(row).toMatchObject({ subject: "", fromAddress: "", cleanText: "", sourceId: null });
    expect(row.lastError).toContain("boom");
    expect(putRaw).toHaveLength(1);
  });

  it("stores the row when cleanText or the url step throws", async () => {
    const mod = await import("@/lib/news/email");
    vi.spyOn(mod, "cleanText").mockImplementationOnce(() => {
      throw new Error("bad html");
    });
    const { deps, rows } = fakeDeps();
    const result = await ingestEmail(load("issue.eml"), deps, webhook());
    const row = [...rows.values()][0];
    expect(result.issueStatus).toBe("pending");
    expect(row.cleanText).toBe("");
    expect(row.lastError).toContain("clean: bad html");
  });

  it("hashes a Message-ID over 1000 chars", async () => {
    const { deps, rows } = fakeDeps();
    const raw = new TextEncoder().encode(
      `Message-ID: <${"a".repeat(1500)}@x.test>\r\nFrom: a@b.test\r\nSubject: s\r\nDate: Mon, 09 Nov 2026 02:30:00 +0000\r\n\r\nhi`,
    );
    await ingestEmail(raw, deps, webhook());
    expect([...rows.values()][0].messageId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("uses a time-independent path when there is no Date header", async () => {
    const a = fakeDeps();
    const b = fakeDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await ingestEmail(load("plain-undated.eml"), a.deps, webhook());
    vi.setSystemTime(new Date("2027-06-01T00:00:00Z"));
    await ingestEmail(load("plain-undated.eml"), b.deps, webhook());
    vi.useRealTimers();
    expect(a.putRaw[0]).toMatch(/^news\/raw\/undated\/[0-9a-f]{64}\.eml$/);
    expect(a.putRaw[0]).toBe(b.putRaw[0]);
  });

  it("handles the insert race by returning the winner as duplicate", async () => {
    const { deps } = fakeDeps();
    let calls = 0;
    deps.findIssueId = async () => (calls++ === 0 ? null : "winner");
    deps.insertIssue = async () => null;
    const result = await ingestEmail(load("issue.eml"), deps, webhook());
    expect(result).toMatchObject({ status: "duplicate", id: "winner" });
  });
});

describe("publicIssueUrl", () => {
  it("rejects a slug the database would refuse", () => {
    const e = { messageId: "m", from: "", subject: "", date: null, forwardedFor: null, html: null, text: null,
      listPost: "<https://www.example-brew.test/archive/it's-here>" };
    expect(publicIssueUrl(brew, e, null)).toBe("https://www.example-brew.test/");
  });

  const email = (over: Partial<ParsedEmail> = {}): ParsedEmail => ({
    messageId: "m", from: "", subject: "", date: null, forwardedFor: null, listPost: null, html: null, text: null, ...over,
  });
  const src = (over: Partial<NewsSource> = {}): NewsSource => ({ ...brew, ...over });

  it("fills date parts", () => {
    const s = src({ archivePattern: "https://www.example-brew.test/{yyyy}/{mm}/{dd}" });
    expect(publicIssueUrl(s, email(), "2026-11-09")).toBe("https://www.example-brew.test/2026/11/09");
  });

  it("fills slug from list-post and view-online links", () => {
    expect(publicIssueUrl(brew, email({ listPost: "<https://www.example-brew.test/archive/a-b>" }), null)).toBe(
      "https://www.example-brew.test/archive/a-b",
    );
    const html = '<a href="https://www.example-brew.test/p/x-y">View this email online</a>';
    expect(publicIssueUrl(src({ archivePattern: "https://www.example-brew.test/p/{slug}" }), email({ html }), null)).toBe(
      "https://www.example-brew.test/p/x-y",
    );
  });

  it("rejects unsafe slug links and falls back to homepage", () => {
    const bad = [
      "https://www.example-brew.test/archive/x?u=1",
      "http://www.example-brew.test/archive/x",
      "https://other.test/archive/x",
      `https://www.example-brew.test/archive/${"a1".repeat(20)}`,
    ];
    for (const link of bad) {
      expect(publicIssueUrl(brew, email({ listPost: link }), "2026-11-09")).toBe("https://www.example-brew.test/");
    }
  });

  it("never returns a query string or fragment", () => {
    const s = src({ homepage: "https://www.example-brew.test/?ref=abc", archivePattern: null });
    expect(publicIssueUrl(s, email(), null)).toBeNull();
    const t = src({ archivePattern: "https://www.example-brew.test/{dd}?x=1" });
    expect(publicIssueUrl(t, email(), "2026-11-09")).toBe("https://www.example-brew.test/");
  });

  it("falls back when date is missing", () => {
    const s = src({ archivePattern: "https://www.example-brew.test/{yyyy}" });
    expect(publicIssueUrl(s, email(), null)).toBe("https://www.example-brew.test/");
  });
});
