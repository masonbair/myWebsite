// Sends new HiNote transcripts to the Ideas Lab, read-only: it never writes in the transcripts folder or touches hinote-sync.
// Run by launchd with Node 24; it takes the transcripts folder, then optionally --include-existing or --since YYYY-MM-DD, and HUB_URL from the environment.
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Which transcripts that were already there at install may be sent: none, all, or those changed on or after a local date. */
export type Existing = "skip" | "all" | { since: string };

export type SyncDeps = {
  /** hinote-sync's transcripts folder; only read. */
  dir: string;
  /** Holds the token file and the sent list. */
  configDir: string;
  hubUrl: string;
  fetch: typeof fetch;
  now: () => Date;
  log: (line: string) => void;
  existing?: Existing;
};

const TOKEN_FILE = "ideas-recording-token";
const SENT_FILE = "ideas-recording-sent.json";
const SKIPPED = "skipped at install";
// hinote-sync writes a transcript in one go, but a file touched this recently may still be mid-write.
const SETTLE_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 30_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** A date as local YYYY-MM-DDTHH:MM:SS, the shape the hub's `recorded` takes. */
export function localTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The command line after the script path, or what is wrong with it. */
export function parseArgs(args: string[], defaultDir: string): { dir: string; existing: Existing } | string {
  let dir: string | null = null;
  let existing: Existing = "skip";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--include-existing") {
      existing = "all";
    } else if (arg === "--since") {
      const since = args[++i] ?? "";
      const real = DATE.test(since) && new Date(`${since}T00:00:00Z`).toISOString().slice(0, 10) === since;
      if (!real) return "--since needs a real date, YYYY-MM-DD";
      existing = { since };
    } else if (arg.startsWith("-") || dir !== null) {
      return `unexpected argument ${arg}`;
    } else {
      dir = arg;
    }
  }
  return { dir: dir ?? defaultDir, existing };
}

/** Only https, or plain http to this Mac, may carry the token. */
function hubUrlProblem(hubUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(hubUrl);
  } catch {
    return `HUB_URL ${hubUrl} is not a URL`;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return null;
  return "HUB_URL must be https, or http://localhost or http://127.0.0.1";
}

/** The token, or why it may not be used: it must be a plain file of Mason's, readable by no one else. */
function readToken(path: string): string | { refused: string } {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return { refused: `no token file at ${path}` };
  }
  if (!info.isFile()) return { refused: `${path} must be a plain file` };
  if ((info.mode & 0o777) !== 0o600) return { refused: `${path} must be mode 600 (chmod 600 ${path})` };
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) return { refused: `${path} must be owned by you` };
  const token = readFileSync(path, "utf8").trim();
  return token ? token : { refused: `${path} is empty` };
}

/** The sent list, null when there is none yet, or "corrupt". */
function readSent(path: string): Record<string, string> | null | "corrupt" {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, string>) : "corrupt";
  } catch {
    return "corrupt";
  }
}

function writeSent(configDir: string, sent: Record<string, string>): void {
  const target = join(configDir, SENT_FILE);
  const temp = `${target}.tmp`;
  // A leftover temp file would keep its old mode; a fresh exclusive create always gets 600.
  rmSync(temp, { force: true });
  writeFileSync(temp, `${JSON.stringify(sent, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temp, target);
}

/** Whether a transcript skipped at install was opted back in by --include-existing or --since. */
function optedIn(existing: Existing, mtime: Date): boolean {
  if (existing === "skip") return false;
  return existing === "all" || localTime(mtime).slice(0, 10) >= existing.since;
}

/** One pass: posts each settled, non-empty transcript not sent before. Returns 0 done, 1 stopped (retry next run), 2 refused. */
export async function syncRecordings(deps: SyncDeps): Promise<number> {
  const existing = deps.existing ?? "skip";
  const urlProblem = hubUrlProblem(deps.hubUrl);
  if (urlProblem) {
    deps.log(`refusing to run: ${urlProblem}`);
    return 2;
  }
  const token = readToken(join(deps.configDir, TOKEN_FILE));
  if (typeof token !== "string") {
    deps.log(`refusing to run: ${token.refused}`);
    return 2;
  }
  const read = readSent(join(deps.configDir, SENT_FILE));
  if (read === "corrupt") {
    deps.log(`refusing to run: ${SENT_FILE} is not a JSON object; fix or remove it`);
    return 2;
  }
  const settledBefore = deps.now().getTime() - SETTLE_MS;
  const transcripts = readdirSync(deps.dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".txt"))
    .map((e) => ({ name: e.name, mtime: statSync(join(deps.dir, e.name)).mtime }))
    .filter((t) => t.mtime.getTime() <= settledBefore)
    .sort((a, b) => a.name.localeCompare(b.name));

  const sent = read ?? {};
  if (read === null) {
    // The first run sends nothing old unless asked, so a backlog cannot use up the month's cap or file ideas for good.
    for (const t of transcripts) sent[t.name] = SKIPPED;
    writeSent(deps.configDir, sent);
    deps.log(`first run: ${transcripts.length} existing transcripts marked ${SKIPPED}`);
    if (existing === "skip") return 0;
  }

  for (const { name, mtime } of transcripts) {
    const state = sent[name];
    if (state !== undefined && !(state === SKIPPED && optedIn(existing, mtime))) continue;
    const transcript = readFileSync(join(deps.dir, name), "utf8");
    if (!transcript.trim()) continue;
    let status: number;
    try {
      const res = await deps.fetch(`${deps.hubUrl}/api/hub/ideas/recording`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ file: name.slice(0, -".txt".length), recorded: localTime(mtime), transcript }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch {
      deps.log(`${name} not sent: hub unreachable; will retry next run`);
      return 1;
    }
    if (status === 200 || status === 201) {
      sent[name] = "sent";
    } else if (status === 400 || status === 413) {
      // The hub will never take this file as it is, so it is not offered again.
      sent[name] = `rejected ${status}`;
      deps.log(`${name} ${status}`);
    } else {
      deps.log(`${name} ${status}; stopping, will retry next run`);
      return 1;
    }
    writeSent(deps.configDir, sent);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const log = (line: string) => console.log(`${localTime(new Date())} ${line}`);
  const args = parseArgs(process.argv.slice(2), join(homedir(), "HiNotes", "transcripts"));
  if (typeof args === "string") {
    log(`refusing to run: ${args}`);
    process.exit(2);
  }
  syncRecordings({
    dir: args.dir,
    existing: args.existing,
    configDir: join(homedir(), ".config", "hub"),
    hubUrl: (process.env.HUB_URL || "https://masonbair.com").replace(/\/+$/, ""),
    fetch,
    now: () => new Date(),
    log,
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : "failed");
      process.exit(1);
    },
  );
}
