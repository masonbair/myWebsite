// Usage and the order to run things in: docs/hub-setup.md, "Import past newsletters and re-run extraction".
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { get, put } from "@vercel/blob";
import type { ModelId } from "../lib/ai/claude";
import { collect, importMessages, reclean, runEstimate, type Scope } from "../lib/news/backfill";
import { supabaseBackfillStore } from "../lib/news/backfill-store";
import { createIngestDeps } from "../lib/news/ingest-store";
import { readMbox } from "./news-mbox";

const MODELS: ModelId[] = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
const USAGE = `usage: npm run news:backfill -- <command> [--local]
  import --mbox <path> --since <YYYY-MM-DD>
  estimate [--model <id>] [--rerun --from <YYYY-MM-DD> --to <YYYY-MM-DD>]   (asks "Type yes to submit")
  submit   (same as estimate)
  collect  (asks "Type yes to cluster"; run again to resume clustering)
  reclean`;

class UsageError extends Error {}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function day(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new UsageError(`${name} needs a YYYY-MM-DD date`);
  return value;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new UsageError(`${name} is not set; run with env from \`vercel env pull\``);
  return value;
}

function supabase(local: boolean) {
  const url = env("SUPABASE_URL");
  if (new URL(url).protocol !== "https:" && !local) throw new UsageError(`SUPABASE_URL is not https; pass --local for a local stack`);
  return createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
}

function anthropic(): Anthropic {
  return new Anthropic({ apiKey: env("ANTHROPIC_API_KEY_NEWS") });
}

// --local keeps raw emails in a temp folder so a dry run never writes to the real Blob store.
const LOCAL_BLOBS = join(tmpdir(), "news-backfill-local-blobs");

function blobs(local: boolean) {
  if (local) {
    return {
      async put(path: string, raw: Uint8Array) {
        await mkdir(dirname(join(LOCAL_BLOBS, path)), { recursive: true });
        await writeFile(join(LOCAL_BLOBS, path), raw);
      },
      async get(path: string) {
        return readFile(join(LOCAL_BLOBS, path)).then((b) => new Uint8Array(b), () => null);
      },
    };
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) env("BLOB_STORE_ID");
  return {
    async put(path: string, raw: Uint8Array) {
      await put(path, Buffer.from(raw), { access: "private", addRandomSuffix: false, allowOverwrite: true });
    },
    async get(path: string) {
      const blob = await get(path, { access: "private" });
      if (!blob || blob.statusCode !== 200) return null;
      return new Uint8Array(await new Response(blob.stream).arrayBuffer());
    },
  };
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Closed stdin never answers the question, so treat it as "no" instead of hanging.
  const closed = new Promise<string>((resolve) => rl.once("close", () => resolve("")));
  try {
    return await Promise.race([rl.question(question), closed]);
  } finally {
    rl.close();
  }
}

const log = (line: string) => console.log(line);

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  const local = argv.includes("--local");
  if (command === "import") {
    const mbox = flag(argv, "--mbox");
    if (!mbox) throw new UsageError("import needs --mbox <path>");
    const since = day(flag(argv, "--since"), "--since");
    const client = supabase(local);
    const store = blobs(local);
    const deps = createIngestDeps(client, store.put, process.env.HUB_TIME_ZONE || "America/New_York");
    const s = await importMessages(readMbox(mbox), deps, { since, log });
    log("Imported per newsletter:");
    for (const [name, n] of Object.entries(s.bySource).sort()) log(`  ${name}: ${n}`);
    log(`New ${s.created} (quarantined ${s.quarantined}), duplicates ${s.duplicates}, before ${since} ${s.older}, errors ${s.errors}.`);
    return;
  }
  if (command === "estimate" || command === "submit") {
    const model = (flag(argv, "--model") ?? "claude-sonnet-5-5") as ModelId;
    if (!MODELS.includes(model)) throw new UsageError(`--model must be one of ${MODELS.join(", ")}`);
    const scope: Scope = argv.includes("--rerun")
      ? { kind: "rerun", from: day(flag(argv, "--from"), "--from"), to: day(flag(argv, "--to"), "--to") }
      : { kind: "backfill" };
    const client = anthropic();
    await runEstimate(supabaseBackfillStore(supabase(local), client), client, { scope, model, ask, log });
    return;
  }
  if (command === "collect") {
    const client = anthropic();
    await collect(supabaseBackfillStore(supabase(local), client), client, { log, ask });
    return;
  }
  if (command === "reclean") {
    const client = supabase(local);
    const store = blobs(local);
    const s = await reclean(supabaseBackfillStore(client, null), store.get, { log });
    log(`Refilled ${s.fixed}, raw email missing ${s.missing}, still empty after cleaning ${s.empty}.`);
    return;
  }
  throw new UsageError(USAGE);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof UsageError ? e.message : e);
  process.exit(e instanceof UsageError ? 2 : 1);
});
