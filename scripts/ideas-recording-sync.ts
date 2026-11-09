// Sends new HiNote transcripts to the Ideas Lab, read-only: it never writes in the transcripts folder or touches hinote-sync.
// Run by launchd with Node 24; it takes the transcripts folder as its one argument and HUB_URL from the environment.
import { lstatSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type SyncDeps = {
  /** hinote-sync's transcripts folder; only read. */
  dir: string;
  /** Holds the token file and the sent list. */
  configDir: string;
  hubUrl: string;
  fetch: typeof fetch;
  now: () => Date;
  log: (line: string) => void;
};

const TOKEN_FILE = "ideas-recording-token";
const SENT_FILE = "ideas-recording-sent.json";
// hinote-sync writes a transcript in one go, but a file touched this recently may still be mid-write.
const SETTLE_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 30_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** A date as local YYYY-MM-DDTHH:MM:SS, the shape the hub's `recorded` takes. */
export function localTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

function readSent(path: string): Record<string, string> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function writeSent(configDir: string, sent: Record<string, string>): void {
  const target = join(configDir, SENT_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(sent, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, target);
}

/** One pass: posts each settled, non-empty transcript not sent before. Returns 0 done, 1 stopped (retry next run), 2 refused. */
export async function syncRecordings(deps: SyncDeps): Promise<number> {
  const token = readToken(join(deps.configDir, TOKEN_FILE));
  if (typeof token !== "string") {
    deps.log(`refusing to run: ${token.refused}`);
    return 2;
  }
  const sent = readSent(join(deps.configDir, SENT_FILE));
  if (!sent) {
    deps.log(`refusing to run: ${SENT_FILE} is not a JSON object; fix or remove it`);
    return 1;
  }
  const names = readdirSync(deps.dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".txt") && !(e.name in sent))
    .map((e) => e.name)
    .sort();
  const settledBefore = deps.now().getTime() - SETTLE_MS;
  for (const name of names) {
    const path = join(deps.dir, name);
    const { mtime } = statSync(path);
    if (mtime.getTime() > settledBefore) continue;
    const transcript = readFileSync(path, "utf8");
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
  const deps: SyncDeps = {
    dir: process.argv[2] ?? join(homedir(), "HiNotes", "transcripts"),
    configDir: join(homedir(), ".config", "hub"),
    hubUrl: (process.env.HUB_URL || "https://masonbair.com").replace(/\/+$/, ""),
    fetch,
    now: () => new Date(),
    log: (line) => console.log(`${localTime(new Date())} ${line}`),
  };
  syncRecordings(deps).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : "failed");
      process.exit(1);
    },
  );
}
