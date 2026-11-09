import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { localTime, parseArgs, syncRecordings, type Existing, type SyncDeps } from "@/scripts/ideas-recording-sync";

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
function deps(statuses: Record<string, number | Error> = {}, extra: { existing?: Existing; hubUrl?: string } = {}): SyncDeps {
  return {
    dir,
    configDir,
    hubUrl: extra.hubUrl ?? "https://hub.test",
    existing: extra.existing,
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

/** An install whose first run already happened, with nothing old left to send. */
const installed = () => writeFileSync(join(configDir, "ideas-recording-sent.json"), "{}\n");
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
  installed();
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
    expect(sent()).toEqual({});
    expect(await syncRecordings(deps())).toBe(0);
    expect(sent()).toEqual({ "a.txt": "sent", "b.txt": "sent" });
  });

  it("stops without marking when the hub cannot be reached", async () => {
    token();
    transcript("a.txt", "x");
    expect(await syncRecordings(deps({ a: new Error("offline") }))).toBe(1);
    expect(sent()).toEqual({});
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
    expect(await syncRecordings(deps())).toBe(2);
    expect(posted).toEqual([]);
  });

  it("on its first run marks every existing transcript skipped at install and sends nothing", async () => {
    rmSync(join(configDir, "ideas-recording-sent.json"));
    token();
    transcript("a.txt", "old idea");
    transcript("b.txt", "older idea");
    expect(await syncRecordings(deps())).toBe(0);
    expect(posted).toEqual([]);
    expect(sent()).toEqual({ "a.txt": "skipped at install", "b.txt": "skipped at install" });
    expect(statSync(join(configDir, "ideas-recording-sent.json")).mode & 0o777).toBe(0o600);
    transcript("c.txt", "a new idea");
    expect(await syncRecordings(deps())).toBe(0);
    expect(posted.map((p) => p.body.file)).toEqual(["c"]);
  });

  it("with --since sends only existing transcripts changed on or after that date", async () => {
    rmSync(join(configDir, "ideas-recording-sent.json"));
    token();
    transcript("old.txt", "x", new Date("2026-11-01T10:00:00"));
    transcript("edge.txt", "y", new Date("2026-11-05T00:00:00"));
    transcript("new.txt", "z", new Date("2026-11-07T10:00:00"));
    expect(await syncRecordings(deps({}, { existing: { since: "2026-11-05" } }))).toBe(0);
    expect(posted.map((p) => p.body.file).sort()).toEqual(["edge", "new"]);
    expect(sent()).toEqual({ "old.txt": "skipped at install", "edge.txt": "sent", "new.txt": "sent" });
  });

  it("with --include-existing sends the ones skipped at install, later too", async () => {
    rmSync(join(configDir, "ideas-recording-sent.json"));
    token();
    transcript("a.txt", "x");
    await syncRecordings(deps());
    expect(posted).toEqual([]);
    expect(await syncRecordings(deps({}, { existing: "all" }))).toBe(0);
    expect(posted.map((p) => p.body.file)).toEqual(["a"]);
    expect(sent()).toEqual({ "a.txt": "sent" });
  });

  it.each(["http://masonbair.com", "http://192.168.1.5:3000", "ftp://masonbair.com", "not a url"])(
    "refuses HUB_URL %s and sends nothing",
    async (hubUrl) => {
      token();
      transcript("a.txt", "x");
      expect(await syncRecordings(deps({}, { hubUrl }))).toBe(2);
      expect(posted).toEqual([]);
    },
  );

  it.each(["https://masonbair.com", "http://localhost:3000", "http://127.0.0.1:18791"])("accepts HUB_URL %s", async (hubUrl) => {
    token();
    transcript("a.txt", "x");
    expect(await syncRecordings(deps({}, { hubUrl }))).toBe(0);
    expect(posted[0].url).toBe(`${hubUrl}/api/hub/ideas/recording`);
  });

  it("writes the sent file mode 600 even over a leftover temp file", async () => {
    token();
    transcript("a.txt", "x");
    const temp = join(configDir, "ideas-recording-sent.json.tmp");
    writeFileSync(temp, "stale");
    chmodSync(temp, 0o644);
    expect(await syncRecordings(deps())).toBe(0);
    expect(statSync(join(configDir, "ideas-recording-sent.json")).mode & 0o777).toBe(0o600);
    expect(sent()).toEqual({ "a.txt": "sent" });
  });

  it("reads its arguments", () => {
    expect(parseArgs([], "/default")).toEqual({ dir: "/default", existing: "skip" });
    expect(parseArgs(["/t", "--include-existing"], "/default")).toEqual({ dir: "/t", existing: "all" });
    expect(parseArgs(["--since", "2026-11-05", "/t"], "/default")).toEqual({ dir: "/t", existing: { since: "2026-11-05" } });
    expect(parseArgs(["--since", "2026-02-30"], "/d")).toMatch(/real date/);
    expect(parseArgs(["--since"], "/d")).toMatch(/real date/);
    expect(parseArgs(["--all"], "/d")).toMatch(/unexpected/);
    expect(parseArgs(["/a", "/b"], "/d")).toMatch(/unexpected/);
  });

  it("formats local time as YYYY-MM-DDTHH:MM:SS", () => {
    expect(localTime(new Date(2026, 0, 5, 7, 3, 9))).toBe("2026-01-05T07:03:09");
  });
});
