import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordUsage, type ModelId } from "@/lib/ai/claude";
import { notify, type Message } from "@/lib/hub/notify";
import { newsCapSpend } from "@/lib/news/budget";
import { refreshSecTickers, resolveCompanies, type CompanyInput } from "@/lib/news/companies";
import { assignClusters } from "@/lib/news/dedupe";
import { ExtractError, extractIssue, type ExtractInput, type ModelCharge } from "@/lib/news/extract";
import { PROMPT_VERSION, type Topic } from "@/lib/news/prompt";
import { fetchReadable, liveReadableDeps, type Readable } from "@/lib/news/shared-fetch";

export type WorkKind = "issue" | "shared";

/** A claimed issue with what extraction needs. */
export type IssueWork = {
  id: string;
  sourceId: string | null;
  sourceName: string;
  subject: string;
  storyDate: string;
  text: string;
  attempts: number;
};

/** A claimed shared article; `description` is the inbox item's text, used when the page cannot be read. */
export type SharedWork = {
  id: string;
  itemId: string;
  url: string;
  title: string;
  description: string;
  fetchedText: string | null;
  storyDate: string;
  attempts: number;
};

export type StoryInsert = {
  run_id: number;
  issue_id: string | null;
  shared_id: string | null;
  source_id: string;
  story_date: string;
  headline: string;
  kind: string;
  sentiment: number;
  topics: string[];
  suggested_topic: string | null;
  company_ids: number[];
  link: string | null;
};

export type StoryDate = { id: number; storyDate: string };

/** Storage and outside calls the job needs; `supabaseNewsJobStore` is the real one. */
export type NewsJobStore = {
  refreshSec(now: Date): Promise<void>;
  capSpend(now: Date): Promise<number>;
  getState(key: string): Promise<unknown>;
  setState(key: string, value: unknown): Promise<void>;
  claim(kind: WorkKind, limit: number): Promise<string[]>;
  loadIssue(id: string): Promise<IssueWork | null>;
  loadShared(id: string): Promise<SharedWork | null>;
  topics(): Promise<Topic[]>;
  /** Today's (UTC) daily run for this model and PROMPT_VERSION, created on first use. */
  dailyRun(model: ModelId, now: Date): Promise<number>;
  hasStories(kind: WorkKind, id: string, runId: number): Promise<boolean>;
  recordCharge(charge: ModelCharge, purpose: "extract" | "shared", ref: { newsIssueId?: string; itemId?: string }): Promise<number>;
  resolveCompanies(companies: CompanyInput[]): Promise<number[]>;
  insertStories(rows: StoryInsert[]): Promise<StoryDate[]>;
  saveFetched(id: string, text: string): Promise<void>;
  finish(kind: WorkKind, id: string, runId: number, extra?: { thin: boolean }): Promise<void>;
  fail(kind: WorkKind, id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void>;
  /** Hands an untouched claim back as pending, so a deadline stop costs no attempt. */
  release(kind: WorkKind, id: string): Promise<void>;
  /** Current-run news stories from the week before `now` still waiting for a cluster. */
  unclustered(now: Date): Promise<StoryDate[]>;
  cluster(storyIds: number[]): Promise<void>;
  refreshTrends(from: string, to: string): Promise<void>;
  failedRows(): Promise<{ sourceName: string; date: string; error: string | null }[]>;
  /** Each active public newsletter with its newest received_at, or null when it never sent one. */
  sourceSilence(): Promise<{ id: string; name: string; newestAt: string | null }[]>;
  fetchReadable(url: string): Promise<Readable | null>;
};

export type NewsJobDeps = {
  client: SupabaseClient;
  anthropic: Anthropic | null;
  model: ModelId;
  now: () => Date;
  /** No extraction starts after this; clustering chunks may start for CLUSTER_EXTRA_MS more. */
  deadlineMs: number;
  cap: number;
  ntfyTopic: string | undefined;
  fetchFn: typeof fetch;
  timeZone: string;
  /** Tests pass a fake; otherwise built from `client`. */
  store?: NewsJobStore;
};

export type NewsJobResult = { extracted: string[]; failed: string[]; clustered: number; paused: boolean; alerts: string[] };

export const NEWS_MODEL: ModelId = "claude-sonnet-5-5";
const ISSUES_PER_RUN = 5;
const SHARED_PER_RUN = 3;
const RETRY_BASE_MS = 30 * 60_000;
const SILENT_MS = 3 * 24 * 60 * 60_000;
const REPORT_HOUR = 13;
const NEWS_URL = "https://masonbair.com/hub/news";
const PAUSED_KEY = "news:paused";
const PAUSED_ALERT_KEY = "news:paused-alerted";
const CLUSTER_EXTRA_MS = 60_000;
const CLUSTER_CHUNK = 5;
const REPORT_KEY = "news:failure-report";
const silentKey = (id: string) => `news:silent:${id}`;
const MAX_ERROR = 500;

const utcMonth = (d: Date) => d.toISOString().slice(0, 7);

function localDateHour(d: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One run of the scheduled news job: claim, extract, cluster, refresh trends, alert. */
export async function runNewsJob(deps: NewsJobDeps): Promise<NewsJobResult> {
  const store = deps.store ?? supabaseNewsJobStore(deps.client, deps.anthropic, deps.fetchFn);
  const result: NewsJobResult = { extracted: [], failed: [], clustered: 0, paused: false, alerts: [] };
  const started = deps.now().getTime();
  const elapsed = () => deps.now().getTime() - started;
  const timeLeft = () => elapsed() < deps.deadlineMs;
  const clusterTimeLeft = () => elapsed() < deps.deadlineMs + CLUSTER_EXTRA_MS;

  async function alert(key: string, value: string, label: string, msg: Message): Promise<void> {
    if (!deps.ntfyTopic) return;
    try {
      await notify(deps.ntfyTopic, { clickUrl: NEWS_URL, ...msg }, deps.fetchFn);
    } catch (e) {
      console.error(`news alert ${label} not sent: ${(e as Error).message}`);
      return;
    }
    await store.setState(key, value);
    result.alerts.push(label);
  }

  try {
    await store.refreshSec(deps.now());
  } catch (e) {
    console.error(`news sec refresh failed: ${(e as Error).message}`);
  }

  const month = utcMonth(deps.now());
  let spend = await store.capSpend(deps.now());
  if (spend >= deps.cap) {
    result.paused = true;
    if ((await store.getState(PAUSED_KEY)) !== month) await store.setState(PAUSED_KEY, month);
    // Its own key, set only after a good send, so a failed ntfy is retried next run while the page still shows the pause.
    if ((await store.getState(PAUSED_ALERT_KEY)) !== month) {
      await alert(PAUSED_ALERT_KEY, month, "paused", {
        title: "News extraction paused",
        message: `This month's Claude spend reached the $${deps.cap} cap. New issues wait until next month or a higher cap.`,
      });
    }
    await sendDailyAlerts(store, deps, alert);
    return result;
  }
  if ((await store.getState(PAUSED_KEY)) === month) await store.setState(PAUSED_KEY, false);

  const newStories: StoryDate[] = [];
  if (deps.anthropic) {
    const anthropic = deps.anthropic;
    let topics: Topic[] | null = null;
    let runId: number | null = null;
    const prepare = async () => {
      topics ??= await store.topics();
      runId ??= await store.dailyRun(deps.model, deps.now());
      return { topics, runId };
    };

    const work: [WorkKind, string][] = [
      ...(await store.claim("issue", ISSUES_PER_RUN)).map((id): [WorkKind, string] => ["issue", id]),
      ...(await store.claim("shared", SHARED_PER_RUN)).map((id): [WorkKind, string] => ["shared", id]),
    ];
    let next = 0;
    try {
      for (; next < work.length; next++) {
        const [kind, id] = work[next];
        if (!timeLeft() || spend >= deps.cap) {
          await store.release(kind, id);
          continue;
        }
        const { topics: t, runId: run } = await prepare();
        const outcome =
          kind === "issue"
            ? await processIssue(store, anthropic, deps, id, t, run)
            : await processShared(store, anthropic, deps, id, t, run);
        spend += outcome.spent;
        if (outcome.ok) {
          result.extracted.push(id);
          newStories.push(...outcome.stories);
        } else {
          result.failed.push(id);
        }
      }
    } finally {
      for (const [kind, id] of work.slice(next)) {
        await store.release(kind, id).catch((e: unknown) => console.error(`news release of ${kind} ${id} failed: ${(e as Error).message}`));
      }
    }
  }

  await refreshDates(store, newStories);

  if (deps.anthropic) {
    const clustered = await clusterInChunks(store, deps, newStories, clusterTimeLeft);
    result.clustered = clustered.length;
    await refreshDates(store, clustered);
  }

  await sendDailyAlerts(store, deps, alert);
  return result;
}

async function refreshDates(store: NewsJobStore, stories: StoryDate[]): Promise<void> {
  if (stories.length === 0) return;
  const dates = stories.map((s) => s.storyDate).sort();
  await store.refreshTrends(dates[0], dates[dates.length - 1]);
}

/** Clusters new and leftover stories a few at a time, so a slow or failing dedupe never holds up trends or alerts. */
async function clusterInChunks(
  store: NewsJobStore,
  deps: NewsJobDeps,
  newStories: StoryDate[],
  timeLeft: () => boolean,
): Promise<StoryDate[]> {
  const done: StoryDate[] = [];
  try {
    const seen = new Set(newStories.map((s) => s.id));
    const todo = [...newStories, ...(await store.unclustered(deps.now())).filter((s) => !seen.has(s.id))];
    // assignClusters does not check the cap itself, so dedupe waits for a run with room under it.
    if (todo.length === 0 || (await store.capSpend(deps.now())) >= deps.cap) return done;
    for (let i = 0; i < todo.length && timeLeft(); i += CLUSTER_CHUNK) {
      const chunk = todo.slice(i, i + CLUSTER_CHUNK);
      await store.cluster(chunk.map((s) => s.id));
      done.push(...chunk);
    }
  } catch (e) {
    console.error(`news clustering stopped, the rest waits for the next run: ${(e as Error).message}`);
  }
  return done;
}

type Outcome = { ok: true; stories: StoryDate[]; spent: number } | { ok: false; spent: number };

async function extractAndStore(
  store: NewsJobStore,
  anthropic: Anthropic,
  deps: NewsJobDeps,
  topics: Topic[],
  input: ExtractInput,
  charge: (c: ModelCharge) => Promise<number>,
  row: Omit<StoryInsert, "headline" | "kind" | "sentiment" | "topics" | "suggested_topic" | "company_ids" | "link">,
): Promise<{ stories: StoryDate[]; spent: number }> {
  let spent = 0;
  let extracted;
  try {
    extracted = await extractIssue(input, { client: anthropic, model: deps.model, topics });
  } catch (e) {
    if (e instanceof ExtractError) for (const c of e.charges) spent += await charge(c);
    throw Object.assign(e as Error, { spent });
  }
  for (const c of extracted.charges) spent += await charge(c);
  const rows: StoryInsert[] = [];
  for (const s of extracted.stories) {
    rows.push({
      ...row,
      headline: s.headline,
      kind: s.kind,
      sentiment: s.sentiment,
      topics: s.topics,
      suggested_topic: s.suggestedTopic,
      company_ids: await store.resolveCompanies(s.companies),
      link: s.link,
    });
  }
  const stories = rows.length > 0 ? await store.insertStories(rows) : [];
  return { stories, spent };
}

const MAX_ATTEMPTS = 3;

class PermanentError extends Error {}

async function failRow(store: NewsJobStore, deps: NewsJobDeps, kind: WorkKind, id: string, attempts: number, e: unknown): Promise<Outcome> {
  const next = e instanceof PermanentError ? MAX_ATTEMPTS : attempts + 1;
  const at = new Date(deps.now().getTime() + RETRY_BASE_MS * 2 ** next).toISOString();
  const message = (e instanceof Error ? e.message : String(e)).slice(0, MAX_ERROR);
  console.error(`news ${kind} ${id} failed (try ${next}): ${message}`);
  await store.fail(kind, id, next, at, message);
  return { ok: false, spent: (e as { spent?: number } | null)?.spent ?? 0 };
}

async function processIssue(
  store: NewsJobStore,
  anthropic: Anthropic,
  deps: NewsJobDeps,
  id: string,
  topics: Topic[],
  runId: number,
): Promise<Outcome> {
  const issue = await store.loadIssue(id);
  if (!issue) return { ok: false, spent: 0 };
  try {
    if (!issue.sourceId) throw new PermanentError("issue has no newsletter source, so its stories have nowhere to go; set source_id and retry");
    // A crash after the insert but before `done` would otherwise double every story under the same run.
    if (await store.hasStories("issue", id, runId)) {
      await store.finish("issue", id, runId);
      return { ok: true, stories: [], spent: 0 };
    }
    const { stories, spent } = await extractAndStore(
      store,
      anthropic,
      deps,
      topics,
      { sourceName: issue.sourceName, subject: issue.subject, publishedOn: issue.storyDate, text: issue.text },
      (c) => store.recordCharge(c, "extract", { newsIssueId: id }),
      { run_id: runId, issue_id: id, shared_id: null, source_id: issue.sourceId, story_date: issue.storyDate },
    );
    await store.finish("issue", id, runId);
    return { ok: true, stories, spent };
  } catch (e) {
    return failRow(store, deps, "issue", id, issue.attempts, e);
  }
}

async function processShared(
  store: NewsJobStore,
  anthropic: Anthropic,
  deps: NewsJobDeps,
  id: string,
  topics: Topic[],
  runId: number,
): Promise<Outcome> {
  const shared = await store.loadShared(id);
  if (!shared) return { ok: false, spent: 0 };
  try {
    if (await store.hasStories("shared", id, runId)) {
      await store.finish("shared", id, runId, { thin: shared.fetchedText === null });
      return { ok: true, stories: [], spent: 0 };
    }
    let text = shared.fetchedText;
    if (text === null) {
      const page = await store.fetchReadable(shared.url);
      if (page) {
        text = page.text;
        await store.saveFetched(id, text);
      }
    }
    const thin = text === null;
    const { stories, spent } = await extractAndStore(
      store,
      anthropic,
      deps,
      topics,
      {
        sourceName: "Shared article",
        subject: shared.title,
        publishedOn: shared.storyDate,
        text: text ?? [shared.title, shared.description].filter(Boolean).join("\n\n"),
      },
      (c) => store.recordCharge(c, "shared", { itemId: shared.itemId }),
      { run_id: runId, issue_id: null, shared_id: id, source_id: "shared", story_date: shared.storyDate },
    );
    await store.finish("shared", id, runId, { thin });
    return { ok: true, stories, spent };
  } catch (e) {
    return failRow(store, deps, "shared", id, shared.attempts, e);
  }
}

async function sendDailyAlerts(
  store: NewsJobStore,
  deps: NewsJobDeps,
  alert: (key: string, value: string, label: string, msg: Message) => Promise<void>,
): Promise<void> {
  if (!deps.ntfyTopic) return;
  const now = deps.now();
  const local = localDateHour(now, deps.timeZone);

  if (local.hour >= REPORT_HOUR && (await store.getState(REPORT_KEY)) !== local.date) {
    const failed = await store.failedRows();
    if (failed.length === 0) {
      await store.setState(REPORT_KEY, local.date);
    } else {
      const lines = failed.slice(0, 10).map((f) => `${f.sourceName}, ${shortDate(f.date)}: ${(f.error ?? "unknown error").slice(0, 80)}`);
      if (failed.length > 10) lines.push(`and ${failed.length - 10} more`);
      await alert(REPORT_KEY, local.date, "failure-report", {
        title: `News: ${failed.length} failed ${failed.length === 1 ? "item" : "items"}`,
        message: lines.join("\n"),
      });
    }
  }

  for (const source of await store.sourceSilence()) {
    if (!source.newestAt) continue;
    const newest = Date.parse(source.newestAt);
    if (!(now.getTime() - newest > SILENT_MS)) continue;
    // Keyed by the last email's date, so each quiet stretch pings once.
    const lastDate = new Date(newest).toISOString().slice(0, 10);
    if ((await store.getState(silentKey(source.id))) === lastDate) continue;
    await alert(silentKey(source.id), lastDate, `silent:${source.id}`, {
      title: `No ${source.name} for 3 days`,
      message: `Nothing from ${source.name} since ${shortDate(lastDate)}. The Gmail filter may have stopped forwarding it.`,
    });
  }
}

type IssueDb = {
  id: string;
  source_id: string | null;
  subject: string;
  published_on: string | null;
  received_at: string;
  clean_text: string;
  attempts: number;
  source: { name: string } | null;
};

type SharedDb = {
  id: string;
  item_id: string;
  url: string;
  title: string;
  fetched_text: string | null;
  created_at: string;
  attempts: number;
  item: { description: string | null } | null;
};

const table = (kind: WorkKind) => (kind === "issue" ? "news_issues" : "news_shared");
const ownerColumn = (kind: WorkKind) => (kind === "issue" ? "issue_id" : "shared_id");
const DAY_MS = 24 * 60 * 60_000;
const UNCLUSTERED_LIMIT = 200;
const UNCLUSTERED_PAGE = 1000;

function check<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}

/** NewsJobStore over Supabase (service role); shared pages go through liveReadableDeps so DNS answers stay pinned. */
export function supabaseNewsJobStore(client: SupabaseClient, anthropic: Anthropic | null, fetchFn: typeof fetch): NewsJobStore {
  let topicCache: Topic[] | null = null;
  return {
    async refreshSec(now) {
      await refreshSecTickers(client, fetchFn, now);
    },
    capSpend: (now) => newsCapSpend(client, now),
    async getState(key) {
      const row = check(await client.from("hub_state").select("value").eq("key", key).maybeSingle());
      return row?.value ?? null;
    },
    async setState(key, value) {
      check(await client.from("hub_state").upsert({ key, value, updated_at: new Date().toISOString() }));
    },
    async claim(kind, limit) {
      const ids = check(await client.rpc("news_claim", { p_kind: kind, p_limit: limit }));
      return (ids ?? []) as string[];
    },
    async loadIssue(id) {
      const r = check(
        await client
          .from("news_issues")
          .select("id, source_id, subject, published_on, received_at, clean_text, attempts, source:news_sources(name)")
          .eq("id", id)
          .maybeSingle(),
      ) as unknown as IssueDb | null;
      if (!r) return null;
      return {
        id: r.id,
        sourceId: r.source_id,
        sourceName: r.source?.name ?? "Newsletter",
        subject: r.subject,
        storyDate: r.published_on ?? r.received_at.slice(0, 10),
        text: r.clean_text,
        attempts: r.attempts,
      };
    },
    async loadShared(id) {
      const r = check(
        await client
          .from("news_shared")
          .select("id, item_id, url, title, fetched_text, created_at, attempts, item:items(description)")
          .eq("id", id)
          .maybeSingle(),
      ) as unknown as SharedDb | null;
      if (!r) return null;
      return {
        id: r.id,
        itemId: r.item_id,
        url: r.url,
        title: r.title,
        description: r.item?.description ?? "",
        fetchedText: r.fetched_text,
        storyDate: new Date(r.created_at).toISOString().slice(0, 10),
        attempts: r.attempts,
      };
    },
    async topics() {
      topicCache ??= (check(await client.from("news_topics").select("slug, name").eq("active", true).order("slug")) ?? []) as Topic[];
      return topicCache;
    },
    async dailyRun(model, now) {
      const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
      const found = check(
        await client
          .from("news_extraction_runs")
          .select("id")
          .eq("model", model)
          .eq("prompt_version", PROMPT_VERSION)
          .eq("kind", "daily")
          .gte("created_at", dayStart)
          .order("id")
          .limit(1)
          .maybeSingle(),
      );
      if (found) return found.id as number;
      const made = check(
        await client.from("news_extraction_runs").insert({ model, prompt_version: PROMPT_VERSION, kind: "daily" }).select("id").single(),
      );
      return (made as { id: number }).id;
    },
    async hasStories(kind, id, runId) {
      const rows = check(await client.from("news_stories").select("id").eq(ownerColumn(kind), id).eq("run_id", runId).limit(1));
      return (rows ?? []).length > 0;
    },
    recordCharge: (charge, purpose, ref) =>
      recordUsage(client, {
        feature: "news",
        model: charge.model,
        itemId: ref.itemId ?? null,
        newsIssueId: ref.newsIssueId,
        purpose,
        usage: charge.usage,
      }),
    resolveCompanies: (companies) => resolveCompanies(client, companies),
    async insertStories(rows) {
      const data = check(await client.from("news_stories").insert(rows).select("id, story_date").order("id"));
      return ((data ?? []) as { id: number; story_date: string }[]).map((r) => ({ id: r.id, storyDate: r.story_date }));
    },
    async saveFetched(id, text) {
      check(await client.from("news_shared").update({ fetched_text: text }).eq("id", id).is("fetched_text", null));
    },
    async finish(kind, id, runId, extra) {
      const columns: Record<string, unknown> = { status: "done", current_run_id: runId, last_error: null, next_attempt_at: null };
      if (kind === "shared" && extra) columns.thin = extra.thin;
      check(await client.from(table(kind)).update(columns).eq("id", id));
    },
    async fail(kind, id, attempts, nextAttemptAt, error) {
      check(await client.from(table(kind)).update({ status: "failed", attempts, next_attempt_at: nextAttemptAt, last_error: error }).eq("id", id));
    },
    async release(kind, id) {
      check(await client.from(table(kind)).update({ status: "pending", claimed_at: null }).eq("id", id).eq("status", "processing"));
    },
    async unclustered(now) {
      const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const out: StoryDate[] = [];
      // PostgREST cannot compare run_id with the joined current_run_id, so pages are filtered here until enough are found.
      for (let from = 0; out.length < UNCLUSTERED_LIMIT; from += UNCLUSTERED_PAGE) {
        const rows = check(
          await client
            .from("news_stories")
            .select("id, run_id, story_date, issue_id, issue:news_issues(current_run_id), shared:news_shared(current_run_id)")
            .eq("kind", "news")
            .is("cluster_id", null)
            .gte("created_at", since)
            .order("id")
            .range(from, from + UNCLUSTERED_PAGE - 1),
        ) as unknown as {
          id: number;
          run_id: number;
          story_date: string;
          issue_id: string | null;
          issue: { current_run_id: number | null } | null;
          shared: { current_run_id: number | null } | null;
        }[];
        for (const r of rows ?? []) {
          if ((r.issue_id ? r.issue?.current_run_id : r.shared?.current_run_id) === r.run_id) out.push({ id: r.id, storyDate: r.story_date });
        }
        if ((rows ?? []).length < UNCLUSTERED_PAGE) break;
      }
      return out.slice(0, UNCLUSTERED_LIMIT);
    },
    async cluster(storyIds) {
      if (!anthropic) return;
      await assignClusters(client, anthropic, storyIds);
    },
    async refreshTrends(from, to) {
      check(await client.rpc("news_refresh_trends", { p_from: from, p_to: to }));
    },
    async failedRows() {
      const issues = check(
        await client.from("news_issues").select("received_at, last_error, source:news_sources(name)").eq("status", "failed").order("received_at"),
      ) as unknown as { received_at: string; last_error: string | null; source: { name: string } | null }[];
      const shared = check(
        await client.from("news_shared").select("created_at, last_error").eq("status", "failed").order("created_at"),
      ) as { created_at: string; last_error: string | null }[];
      return [
        ...(issues ?? []).map((r) => ({ sourceName: r.source?.name ?? "Newsletter", date: r.received_at.slice(0, 10), error: r.last_error })),
        ...(shared ?? []).map((r) => ({ sourceName: "Shared article", date: r.created_at.slice(0, 10), error: r.last_error })),
      ];
    },
    async sourceSilence() {
      const sources = check(await client.from("news_sources").select("id, name").eq("active", true).eq("public", true).order("id")) as {
        id: string;
        name: string;
      }[];
      const out = [];
      for (const s of sources ?? []) {
        const newest = check(
          await client.from("news_issues").select("received_at").eq("source_id", s.id).order("received_at", { ascending: false }).limit(1).maybeSingle(),
        ) as { received_at: string } | null;
        out.push({ id: s.id, name: s.name, newestAt: newest?.received_at ?? null });
      }
      return out;
    },
    fetchReadable: (url) => fetchReadable(url, liveReadableDeps),
  };
}
