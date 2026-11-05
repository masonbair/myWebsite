import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHttpStore, HubApiError } from "./http-store";
import { LABEL_PATTERN, MAX_WORKER_COMMENT } from "./input";
import { lateTasks, migrateLate } from "./late-migrate";
import { listMemos, parsePieces, splitMemo } from "./memo-split";
import { notify, type Message } from "./notify";
import { applySchedule, offsetMinutesAt, parsePlan, scheduleInput } from "./schedule";
import type { Item } from "./types";
import { CLIENT_KEY, type HubWorker, type Outcome } from "./worker-api";

export type CliDeps = {
  hub: HubWorker;
  notify: (msg: Message) => Promise<void>;
  now: () => Date;
  /** IANA zone Mason is in; scheduling uses it the way todo-hub used the Todoist account's zone. */
  timeZone: string;
  /** Project label keys a memo piece may carry; anything else is dropped or filed as an idea. */
  projects: () => string[];
  out: (s: string) => void;
  err: (s: string) => void;
};

const USAGE = `usage: hub <command>
  setup                               check the hub answers with this token
  approved                            JSON of items Mason approved and no run holds
  claim <id>                          take an item (exit 3 if not claimable)
  finish <id> --comment-file <path>   post result, mark claude-done, ping phone (exit 3 if not claimed)
  block <id> --comment-file <path>    post questions, mark claude-question, ping phone (exit 3 if not claimed)
  laptop                              JSON of open laptop items
  inbox                               JSON of unsorted inbox items
  item <id>                           JSON of one item
  comments <id>                       JSON of an item's comments, oldest first
  sort <id> --kind todo|idea|thought [--project <key>] [--laptop] [--due YYYY-MM-DD]
                                      label and file an inbox item, keeping its labels
  merge <newer-id> --into <older-id> --comment-file <path>
                                      copy the note onto the older item, archive the newer one into it
  add --title <t> [--description-file <path>] [--labels a,b] [--key <k>]
                                      add an inbox item; a repeated --key returns the first item
  alert <message>                     ping phone with a hub problem
  granola-since                       time of the last Granola sweep (default 48h ago)
  granola-done <iso time>             record a finished Granola sweep
  memos                               JSON of open HiDock memos with transcripts
  memo-split <id> --pieces <path>     file a memo's pieces, then archive it (exit 2: bad pieces)
  memo-seed <list-file>               mark HiDock file names (one per line) as already filed
  to-schedule                         JSON of the scheduling horizon and to-dos waiting for a date
  schedule --plan <path>              estimate and date waiting to-dos (exit 2: bad plan)
  late-migrate [--apply [--keep ids]] list old "(late)" memo items; --apply re-spreads them`;

const GRANOLA_KEY = "granola-swept-until";
const DEFAULT_SWEEP_MS = 48 * 60 * 60 * 1000;
const KINDS = ["todo", "idea", "thought"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Keeps each request well under the worker API's 256 KB body cap.
const SEED_BATCH = 1000;

const summary = (t: Item) => ({ id: t.id, title: t.title, url: t.url, updatedAt: t.updatedAt });

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function readComment(file: string, deps: CliDeps): string | null {
  const comment = readFileSync(file, "utf8").trim();
  if (comment.length <= MAX_WORKER_COMMENT) return comment;
  deps.err(`comment is ${comment.length} characters; the hub takes at most ${MAX_WORKER_COMMENT}. Shorten it and run again.`);
  return null;
}

async function report(id: string, args: string[], deps: CliDeps, outcome: Outcome): Promise<number> {
  const file = flag(args, "--comment-file");
  if (!file) {
    deps.err(USAGE);
    return 2;
  }
  const comment = readComment(file, deps);
  if (comment === null) return 2;
  let item: Item;
  try {
    item = await deps.hub.report(id, outcome, comment);
  } catch (e) {
    if (!(e instanceof HubApiError && e.status === 409)) throw e;
    // Same exit as a lost claim: this run does not hold the item.
    deps.err(`not claimed: ${e.message}`);
    return 3;
  }
  try {
    const title = `${outcome === "finish" ? "Done" : "Question"}: ${item.title}`;
    await deps.notify({ title, message: comment.split("\n")[0], clickUrl: item.url });
  } catch (e) {
    deps.err(`notify failed (result is on the item): ${(e as Error).message}`);
  }
  return 0;
}

async function sort(id: string, args: string[], deps: CliDeps): Promise<number> {
  const kind = flag(args, "--kind");
  const project = flag(args, "--project");
  const due = flag(args, "--due");
  const usageError = (message: string) => {
    deps.err(message);
    return 2;
  };
  if (!kind || !KINDS.includes(kind)) return usageError("--kind must be todo, idea or thought");
  if (project !== undefined && !LABEL_PATTERN.test(project)) return usageError("--project must be a label key");
  if (due !== undefined && !DATE.test(due)) return usageError("--due must be YYYY-MM-DD");
  const item = await deps.hub.getItem(id);
  if (!item) {
    deps.err(`no item ${id}`);
    return 1;
  }
  if (due && (item.labels.includes("to-schedule") || item.labels.includes("suggested"))) {
    return usageError(`item ${id} waits for scheduling; hub schedule owns its date`);
  }
  const added = [kind, project, args.includes("--laptop") ? "laptop" : undefined].filter((l): l is string => !!l);
  await deps.hub.updateItem(id, {
    labels: [...new Set([...item.labels, ...added])],
    list: kind === "todo" ? "todo" : "ideas",
    ...(due ? { due: { date: due, time: null } } : {}),
  });
  return 0;
}

/** Run one hub command; returns the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [cmd, id, ...rest] = argv;
  const offset = () => offsetMinutesAt(deps.timeZone, deps.now());
  try {
    switch (cmd) {
      case "setup":
        await deps.hub.health();
        deps.out("ok");
        return 0;
      case "approved":
        deps.out(JSON.stringify((await deps.hub.view("approved")).map(summary)));
        return 0;
      case "laptop":
        deps.out(JSON.stringify((await deps.hub.view("laptop")).map(summary)));
        return 0;
      case "inbox":
        deps.out(JSON.stringify(await deps.hub.view(cmd)));
        return 0;
      case "memos": {
        const { memos, skipped } = await listMemos(deps.hub);
        for (const skippedId of skipped) deps.err(`skipped ${skippedId}: not a readable HiDock memo`);
        deps.out(JSON.stringify(memos));
        return 0;
      }
      case "item": {
        if (!id) break;
        const item = await deps.hub.getItem(id);
        if (!item) {
          deps.err(`no item ${id}`);
          return 1;
        }
        deps.out(JSON.stringify(item));
        return 0;
      }
      case "comments":
        if (!id) break;
        deps.out(JSON.stringify(await deps.hub.listComments(id)));
        return 0;
      case "claim":
        if (!id) break;
        if (await deps.hub.claim(id)) return 0;
        deps.err(`not claimable: ${id}`);
        return 3;
      case "finish":
      case "block":
        if (!id) break;
        return await report(id, rest, deps, cmd);
      case "sort":
        if (!id) break;
        return await sort(id, rest, deps);
      case "merge": {
        const into = flag(rest, "--into");
        const file = flag(rest, "--comment-file");
        if (!id || !into || !file) break;
        const note = readComment(file, deps);
        if (note === null) return 2;
        await deps.hub.merge(id, into, note);
        return 0;
      }
      case "add": {
        const title = flag(argv, "--title");
        const file = flag(argv, "--description-file");
        const labels = flag(argv, "--labels");
        const key = flag(argv, "--key");
        if (!title) break;
        if (argv.includes("--key") && (key === undefined || !CLIENT_KEY.test(key))) {
          deps.err("--key must be 1 to 200 of A-Z a-z 0-9 . _ : # -");
          return 2;
        }
        const item = await deps.hub.addItem({
          title,
          description: file ? readFileSync(file, "utf8").trim() : "",
          labels: labels ? labels.split(",").map((l) => l.trim()).filter(Boolean) : [],
          ...(key ? { clientKey: key } : {}),
        });
        deps.out(item.id);
        return 0;
      }
      case "granola-since": {
        const value = await deps.hub.getState(GRANOLA_KEY);
        deps.out(typeof value === "string" ? value : new Date(deps.now().getTime() - DEFAULT_SWEEP_MS).toISOString());
        return 0;
      }
      case "granola-done":
        if (!id || Number.isNaN(Date.parse(id))) break;
        await deps.hub.setState(GRANOLA_KEY, new Date(id).toISOString());
        return 0;
      case "memo-split": {
        const file = flag(rest, "--pieces");
        if (!id || !file) break;
        let pieces;
        try {
          pieces = parsePieces(JSON.parse(readFileSync(file, "utf8")), deps.projects());
        } catch (e) {
          deps.err(`bad pieces: ${(e as Error).message}`);
          return 2;
        }
        deps.out(`filed ${await splitMemo(deps.hub, id, pieces)} pieces`);
        return 0;
      }
      case "memo-seed": {
        if (!id) break;
        const files = readFileSync(id, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
        let seeded = 0;
        let known = 0;
        for (let at = 0; at < files.length; at += SEED_BATCH) {
          const counts = await deps.hub.seedMemoFiles(files.slice(at, at + SEED_BATCH));
          seeded += counts.seeded;
          known += counts.known;
        }
        deps.out(`seeded ${seeded}, already known ${known}`);
        return 0;
      }
      case "to-schedule":
        deps.out(JSON.stringify(await scheduleInput(deps.hub, deps.now(), offset())));
        return 0;
      case "schedule": {
        const file = flag(argv, "--plan");
        if (!file) break;
        let plan;
        try {
          plan = parsePlan(JSON.parse(readFileSync(file, "utf8")));
        } catch (e) {
          deps.err(`bad plan: ${(e as Error).message}`);
          return 2;
        }
        for (const line of await applySchedule(deps.hub, plan, deps.now(), offset())) deps.out(line);
        return 0;
      }
      case "late-migrate": {
        if (!argv.includes("--apply")) {
          deps.out(JSON.stringify(lateTasks(await deps.hub.view("hidock"))));
          return 0;
        }
        const keep = new Set((flag(argv, "--keep") ?? "").split(",").filter(Boolean));
        for (const line of await migrateLate(deps.hub, keep)) deps.out(line);
        return 0;
      }
      case "alert":
        if (!id) break;
        await deps.notify({ title: "hub problem", message: [id, ...rest].join(" ") });
        return 0;
    }
  } catch (e) {
    deps.err((e as Error).message);
    // The hub refused the input itself, so a retry would fail the same way.
    return e instanceof HubApiError && e.status === 400 ? 2 : 1;
  }
  deps.err(USAGE);
  return 2;
}

/** Fill process.env from a KEY=value file, never overriding keys already set. */
export function loadEnv(path = join(homedir(), ".config/hub/env")): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value.replace(/^"(.*)"$/, "$1");
  }
}

/** Keys of a `{ "label": "owner/repo" }` projects file; none when the file is missing. */
export function loadProjects(path = process.env.HUB_PROJECTS_FILE || join(homedir(), ".config/hub/projects.json")): string[] {
  if (!existsSync(path)) return [];
  return Object.keys(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
}

export async function main(argv: string[]): Promise<number> {
  loadEnv();
  for (const key of ["HUB_URL", "HUB_WORKER_TOKEN", "NTFY_TOPIC"]) {
    if (!process.env[key]) {
      console.error(`missing ${key}`);
      return 2;
    }
  }
  const topic = process.env.NTFY_TOPIC!;
  return runCli(argv, {
    hub: createHttpStore(process.env.HUB_URL!, process.env.HUB_WORKER_TOKEN!, randomBytes(4).toString("hex")),
    notify: (msg) => notify(topic, msg),
    now: () => new Date(),
    timeZone: process.env.HUB_TIME_ZONE || "America/Denver",
    projects: () => loadProjects(),
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  });
}
