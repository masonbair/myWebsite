import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { localTime, syncRecordings, type SyncDeps } from "@/scripts/ideas-recording-sync";

const TOKEN = "laptop-token";
const OLD = new Date("2026-11-08T09:00:00");

let dir: string;
let configDir: string;
let posted: { url: string; auth: string | null; body: { file: string; recorded: string; transcript: string } }[];
let logs: string[];

function transcript(name: string, text: string, mtime = OLD) {
  const path = join(dir, name);
  writeFileSync(path, text);
  utimesSync(path, mtime, mtime);
}

function token(mode = 0o600, text = `${TOKEN}\n`) {
  const path = join(configDir, "ideas-recording-token");
  writeFileSync(path, text);
  chmodSync(path, mode);
}

/** A fake hub that answers by file name, defaulting to 201. */
function deps(statuses: Record<string, number | Error> = {}): SyncDeps {
  return {
    dir,
    configDir,
    hubUrl: "https://hub.test",
    now: () => new Date("2026-11-09T12:00:00"),
    log: (line) => logs.push(line),
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      posted.push({ url, auth: new Headers(init.headers).get("authorization"), body });
      const status = statuses[body.file] ?? 201;
      if (status instanceof Error) throw status;
      return new Response(JSON.stringify({ status: "x" }), { status });
    }) as typeof fetch,
  };
}

const sent = () => JSON.parse(readFileSync(join(configDir, "ideas-recording-sent.json"), "utf8")) as Record<string, string>;
const snapshot = () => readdirSync(dir).map((name) => [name, statSync(join(dir, name)).mtimeMs, readFileSync(join(dir, name), "utf8")]);

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "ideas-sync-"));
  dir = join(root, "transcripts");
  configDir = join(root, "config");
  mkdirSync(dir);
  mkdirSync(configDir);
  posted = [];
  logs = [];
});

describe("ideas-recording-sync", () => {
  it("refuses to run unless the token file is mode 600, and sends nothing", async () => {
    transcript("2026Nov08-090000-Rec01.txt", "an idea");
    for (const mode of [0o644, 0o640, 0o700, 0o400]) {
      token(mode);
      expect(await syncRecordings(deps())).toBe(2);
    }
    expect(posted).toEqual([]);
    expect(logs.join("\n")).toContain("600");
  });

  it("refuses a missing or empty token file", async () => {
    expect(await syncRecordings(deps())).toBe(2);
    token(0o600, "  \n");
    expect(await syncRecordings(deps())).toBe(2);
    expect(posted).toEqual([]);
  });

  it("sends each transcript once with its stem, local mtime and the bearer token", async () => {
    token();
    transcript("2026Nov08-090000-Rec01.txt", "an idea: a sourdough timer");
    transcript("notes.md", "not a transcript");
    expect(await syncRecordings(deps())).toBe(0);
    expect(posted).toEqual([
      {
        url: "https://hub.test/api/hub/ideas/recording",
        auth: `Bearer ${TOKEN}`,
        body: { file: "2026Nov08-090000-Rec01", recorded: "2026-11-08T09:00:00", transcript: "an idea: a sourdough timer" },
      },
    ]);
    expect(sent()).toEqual({ "2026Nov08-090000-Rec01.txt": "sent" });
    expect(await syncRecordings(deps())).toBe(0);
    expect(posted).toHaveLength(1);
  });

  it("treats 200 (already there) as sent", async () => {
    token();
    transcript("a.txt", "x");
    expect(await syncRecordings(deps({ a: 200 }))).toBe(0);
    expect(sent()).toEqual({ "a.txt": "sent" });
  });

  it("marks 400 and 413 rejected so they are not retried, logging only name and status", async () => {
    token();
    transcript("bad name.txt", "secret words");
    transcript("huge.txt", "more secret words");
    transcript("ok.txt", "fine");
    expect(await syncRecordings(deps({ "bad name": 400, huge: 413 }))).toBe(0);
    expect(sent()).toEqual({ "bad name.txt": "rejected 400", "huge.txt": "rejected 413", "ok.txt": "sent" });
    await syncRecordings(deps());
    expect(posted).toHaveLength(3);
    expect(logs.join("\n")).not.toContain("secret");
    expect(logs.join("\n")).toContain("huge.txt 413");
  });

  it.each([401, 500, 503])("stops on %i without marking, and tries again next run", async (status) => {
    token();
    transcript("a.txt", "x");
    transcript("b.txt", "y");
    expect(await syncRecordings(deps({ a: status }))).toBe(1);
    expect(posted.map((p) => p.body.file)).toEqual(["a"]);
    expect(() => sent()).toThrow();
    expect(await syncRecordings(deps())).toBe(0);
    expect(sent()).toEqual({ "a.txt": "sent", "b.txt": "sent" });
  });

  it("stops without marking when the hub cannot be reached", async () => {
    token();
    transcript("a.txt", "x");
    expect(await syncRecordings(deps({ a: new Error("offline") }))).toBe(1);
    expect(() => sent()).toThrow();
  });

  it("skips an empty transcript and one written in the last two minutes, without marking either", async () => {
    token();
    transcript("empty.txt", "  \n");
    transcript("fresh.txt", "still being written", new Date("2026-11-09T11:59:30"));
    expect(await syncRecordings(deps())).toBe(0);
    expect(posted).toEqual([]);
  });

  it("never writes inside the transcripts folder", async () => {
    token();
    transcript("a.txt", "x");
    transcript("b.txt", "y");
    transcript("c.txt", "z");
    const before = snapshot();
    await syncRecordings(deps({ b: 400 }));
    await syncRecordings(deps());
    expect(snapshot()).toEqual(before);
    expect(readdirSync(configDir).sort()).toEqual(["ideas-recording-sent.json", "ideas-recording-token"]);
  });

  it("refuses a sent file it cannot read, rather than resending everything", async () => {
    token();
    transcript("a.txt", "x");
    writeFileSync(join(configDir, "ideas-recording-sent.json"), "{not json");
    expect(await syncRecordings(deps())).toBe(1);
    expect(posted).toEqual([]);
  });

  it("formats local time as YYYY-MM-DDTHH:MM:SS", () => {
    expect(localTime(new Date(2026, 0, 5, 7, 3, 9))).toBe("2026-01-05T07:03:09");
  });
});
