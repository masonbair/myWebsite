import type Anthropic from "@anthropic-ai/sdk";
import { costOf, type ModelId, type UsageRow } from "@/lib/ai/claude";
import { cleanText, matchSource, parseEmail } from "@/lib/news/email";
import { buildExtractRequest, readExtractMessage, type ExtractedStory } from "@/lib/news/extract";
import { ingestEmail, type IngestDeps } from "@/lib/news/ingest";
import { PROMPT_VERSION, type Topic } from "@/lib/news/prompt";
import type { IssueStatus } from "@/lib/news/types";

export type RunKind = "backfill" | "rerun";
export type Scope = { kind: "backfill" } | { kind: "rerun"; from: string; to: string };

export type IssueForExtract = {
  id: string;
  sourceId: string;
  sourceName: string;
  subject: string;
  publishedOn: string;
  cleanText: string;
  status: IssueStatus;
  currentRunId: number | null;
  rawPath?: string;
  lastError?: string | null;
};

export type StoryWrite = {
  sourceId: string;
  storyDate: string;
  headline: string;
  kind: ExtractedStory["kind"];
  sentiment: number;
  topics: string[];
  suggestedTopic: string | null;
  companies: ExtractedStory["companies"];
  link: string | null;
};

/** One confirmed send: its batches, which of them are collected, and the run its stories land under. */
export type Submission = {
  kind: RunKind;
  model: ModelId;
  promptVersion: string;
  batchIds: string[];
  collected: string[];
  runId: number | null;
  from?: string;
  to?: string;
  submittedAt: string;
};
export type BatchState = { submissions: Submission[] };
export const BATCH_STATE_KEY = "news:batches";

export type BackfillUsage = UsageRow & { newsIssueId?: string };

/** Storage the import, estimate, collect and reclean steps need; `supabaseBackfillStore` is the real one. */
export type BackfillStore = {
  /** Backfill: every `backfill` issue with text. Re-run: `done` issues published in the range. */
  issues(scope: Scope): Promise<IssueForExtract[]>;
  issue(id: string): Promise<IssueForExtract | null>;
  topics(): Promise<Topic[]>;
  getBatches(): Promise<BatchState | null>;
  setBatches(state: BatchState): Promise<void>;
  createRun(kind: RunKind, model: ModelId, promptVersion: string): Promise<number>;
  storiesExist(issueId: string, runId: number): Promise<boolean>;
  writeStories(runId: number, issue: IssueForExtract, stories: StoryWrite[]): Promise<number[]>;
  markDone(issueId: string, runId: number): Promise<void>;
  markFailed(issueId: string, error: string): Promise<void>;
  recordUsage(row: BackfillUsage): Promise<void>;
  /** The run's news stories with no cluster yet, oldest first. */
  unclusteredStoryIds(runId: number): Promise<number[]>;
  cluster(storyIds: number[], purpose: RunKind): Promise<void>;
  runDateRange(runId: number): Promise<{ from: string; to: string } | null>;
  refreshTrends(from: string, to: string): Promise<void>;
  emptyCleanIssues(): Promise<{ id: string; rawPath: string }[]>;
  setCleanText(id: string, text: string): Promise<void>;
};

type Log = (line: string) => void;

export const MAX_BATCH_REQUESTS = 10_000;
// The Batches API caps one batch at 256 MB; stay well under it.
const MAX_BATCH_BYTES = 200 * 1024 * 1024;
const SAMPLE_SIZE = 10;
/** The spec's per-issue output figure; the real number is only known after a run. */
export const OUTPUT_TOKENS_PER_ISSUE = 2_500;

export type ImportSummary = {
  bySource: Record<string, number>;
  created: number;
  duplicates: number;
  quarantined: number;
  older: number;
  errors: number;
};

function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Sends each message through the webhook's intake as backfill mail; skips mail dated before `since`. */
export async function importMessages(
  messages: AsyncIterable<Uint8Array>,
  deps: IngestDeps,
  opts: { since: string; log: Log },
): Promise<ImportSummary> {
  const sources = await deps.sources();
  const cached: IngestDeps = { ...deps, sources: async () => sources };
  const out: ImportSummary = { bySource: {}, created: 0, duplicates: 0, quarantined: 0, older: 0, errors: 0 };
  let seen = 0;
  for await (const raw of messages) {
    seen += 1;
    try {
      const email = await parseEmail(raw).catch(() => null);
      if (email?.date && dayIn(email.date, deps.timeZone) < opts.since) {
        out.older += 1;
        continue;
      }
      const result = await ingestEmail(raw, cached, { kind: "backfill" });
      if (result.status === "duplicate") out.duplicates += 1;
      else {
        out.created += 1;
        if (result.issueStatus === "quarantined") out.quarantined += 1;
        else {
          const name = (email && matchSource(email.from, sources)?.name) ?? "unknown";
          out.bySource[name] = (out.bySource[name] ?? 0) + 1;
        }
      }
    } catch (e) {
      out.errors += 1;
      opts.log(`message ${seen}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (seen % 200 === 0) opts.log(`${seen} messages read`);
  }
  return out;
}

export type Estimate = {
  issues: IssueForExtract[];
  bySource: Record<string, number>;
  sampled: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

function requestFor(issue: IssueForExtract, model: ModelId, topics: Topic[]) {
  return buildExtractRequest(
    { sourceName: issue.sourceName, subject: issue.subject, publishedOn: issue.publishedOn, text: issue.cleanText },
    model,
    topics,
    { batch: true },
  );
}

function sample<T>(list: T[], size: number): T[] {
  if (list.length <= size) return list;
  return Array.from({ length: size }, (_, i) => list[Math.floor((i * list.length) / size)]);
}

/** Counts input tokens on up to 10 evenly spaced issues and scales up; output assumes OUTPUT_TOKENS_PER_ISSUE. */
export async function estimateCost(store: BackfillStore, client: Anthropic, scope: Scope, model: ModelId): Promise<Estimate> {
  const [issues, topics] = await Promise.all([store.issues(scope), store.topics()]);
  const bySource: Record<string, number> = {};
  for (const i of issues) bySource[i.sourceName] = (bySource[i.sourceName] ?? 0) + 1;
  const picked = sample(issues, SAMPLE_SIZE);
  let sampledInput = 0;
  for (const issue of picked) {
    const { model: m, system, messages, output_config } = requestFor(issue, model, topics);
    const counted = await client.beta.messages.countTokens({ model: m, system, messages, output_config });
    sampledInput += counted.input_tokens;
  }
  const inputTokens = picked.length ? Math.round((sampledInput / picked.length) * issues.length) : 0;
  const outputTokens = OUTPUT_TOKENS_PER_ISSUE * issues.length;
  const usd = costOf(model, { input_tokens: inputTokens, output_tokens: outputTokens }, { batch: true });
  return { issues, bySource, sampled: picked.length, inputTokens, outputTokens, usd };
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function formatEstimate(e: Estimate, scope: Scope, model: ModelId): string[] {
  const what = scope.kind === "backfill" ? "backfill" : `re-run from ${scope.from} to ${scope.to}`;
  return [
    `${fmt(e.issues.length)} issues to send (${what}, model ${model}):`,
    ...Object.entries(e.bySource)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, n]) => `  ${name}: ${fmt(n)}`),
    `Input: about ${fmt(e.inputTokens)} tokens (counted on ${e.sampled} sampled issues, scaled up).`,
    `Output: about ${fmt(e.outputTokens)} tokens (assumed ${fmt(OUTPUT_TOKENS_PER_ISSUE)} output tokens per issue, the spec's figure).`,
    `Estimated cost at batch (half) price: $${e.usd.toFixed(2)}, plus a few cents to a few dollars of Haiku dedupe calls at collect.`,
  ];
}

function openSubmission(state: BatchState | null): Submission | undefined {
  return state?.submissions.find((s) => s.collected.length < s.batchIds.length);
}

type BatchRequest = { custom_id: string; params: ReturnType<typeof requestFor> };

function chunkRequests(requests: BatchRequest[]): BatchRequest[][] {
  const chunks: BatchRequest[][] = [];
  let current: BatchRequest[] = [];
  let bytes = 0;
  for (const r of requests) {
    const size = Buffer.byteLength(JSON.stringify(r));
    if (current.length && (current.length >= MAX_BATCH_REQUESTS || bytes + size > MAX_BATCH_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(r);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Prints the estimate, asks for `yes`, and only then sends the Message Batches; anything else sends nothing. */
export async function runEstimate(
  store: BackfillStore,
  client: Anthropic,
  opts: { scope: Scope; model: ModelId; ask: (question: string) => Promise<string>; log: Log },
): Promise<"sent" | "cancelled" | "empty"> {
  const state = await store.getBatches();
  if (openSubmission(state)) throw new Error("an earlier submission is not collected yet; run collect first");

  const estimate = await estimateCost(store, client, opts.scope, opts.model);
  for (const line of formatEstimate(estimate, opts.scope, opts.model)) opts.log(line);
  if (estimate.issues.length === 0) return "empty";

  const answer = await opts.ask("Type yes to submit: ");
  if (answer.trim() !== "yes") {
    opts.log("Not sent.");
    return "cancelled";
  }

  const topics = await store.topics();
  const requests = estimate.issues.map((i) => ({ custom_id: i.id, params: requestFor(i, opts.model, topics) }));
  const submission: Submission = {
    kind: opts.scope.kind,
    model: opts.model,
    promptVersion: PROMPT_VERSION,
    batchIds: [],
    collected: [],
    runId: null,
    ...(opts.scope.kind === "rerun" ? { from: opts.scope.from, to: opts.scope.to } : {}),
    submittedAt: new Date().toISOString(),
  };
  const next: BatchState = { submissions: [...(state?.submissions ?? []), submission] };
  for (const chunk of chunkRequests(requests)) {
    const batch = await client.beta.messages.batches.create({ requests: chunk });
    submission.batchIds.push(batch.id);
    // Saved after each batch so a crash part way still leaves every sent batch collectable.
    await store.setBatches(next);
    opts.log(`Sent batch ${batch.id} with ${fmt(chunk.length)} requests.`);
  }
  return "sent";
}

export type CollectSummary = { done: number; failed: number; skipped: number; pending: number };

function failureText(result: { type: string; error?: { error?: { message?: string } } }): string {
  return result.type === "errored" ? `batch error: ${result.error?.error?.message ?? "unknown"}` : `batch request ${result.type}`;
}

async function collectBatch(
  store: BackfillStore,
  client: Anthropic,
  submission: Submission,
  runId: number,
  batchId: string,
  topics: Topic[],
  summary: CollectSummary,
  log: Log,
): Promise<void> {
  const fail = async (issue: IssueForExtract, reason: string) => {
    summary.failed += 1;
    log(`${issue.id}: ${reason}`);
    // A failed re-run keeps the issue on its earlier run; only backfill mail goes to the daily job.
    if (submission.kind === "backfill") await store.markFailed(issue.id, reason.slice(0, 500));
  };

  for await (const { custom_id, result } of await client.beta.messages.batches.results(batchId)) {
    const issue = await store.issue(custom_id);
    if (!issue) {
      log(`${custom_id}: no such issue, skipped`);
      continue;
    }
    if (issue.currentRunId === runId || (await store.storiesExist(issue.id, runId))) {
      summary.skipped += 1;
      if (issue.currentRunId !== runId) await store.markDone(issue.id, runId);
      continue;
    }
    if (result.type !== "succeeded") {
      await fail(issue, failureText(result as Parameters<typeof failureText>[0]));
      continue;
    }
    const { outcome, charges } = readExtractMessage(result.message, submission.model, topics);
    if (!outcome.ok) {
      for (const c of charges) await recordCharge(store, submission.kind, c, issue.id);
      await fail(issue, `extraction failed (${outcome.reason}): ${outcome.detail}`);
      continue;
    }
    await store.writeStories(
      runId,
      issue,
      outcome.stories.map((s) => ({
        sourceId: issue.sourceId,
        storyDate: issue.publishedOn,
        headline: s.headline,
        kind: s.kind,
        sentiment: s.sentiment,
        topics: s.topics,
        suggestedTopic: s.suggestedTopic,
        companies: s.companies,
        link: s.link,
      })),
    );
    for (const c of charges) await recordCharge(store, submission.kind, c, issue.id);
    await store.markDone(issue.id, runId);
    summary.done += 1;
  }
}

async function recordCharge(store: BackfillStore, kind: RunKind, c: { model: ModelId; usage: UsageRow["usage"] }, issueId: string) {
  await store.recordUsage({ feature: "news", model: c.model, itemId: null, purpose: kind, usage: c.usage, batch: true, newsIssueId: issueId });
}

/** Writes stories for every ended batch, then clusters the run's new stories and rebuilds trends over its dates; safe to repeat. */
export async function collect(store: BackfillStore, client: Anthropic, opts: { log: Log }): Promise<CollectSummary> {
  const summary: CollectSummary = { done: 0, failed: 0, skipped: 0, pending: 0 };
  const state = await store.getBatches();
  if (!state) {
    opts.log("Nothing submitted yet.");
    return summary;
  }
  const topics = await store.topics();
  for (const submission of state.submissions) {
    const open = submission.batchIds.filter((id) => !submission.collected.includes(id));
    if (open.length === 0) continue;
    if (submission.runId === null) {
      submission.runId = await store.createRun(submission.kind, submission.model, submission.promptVersion);
      await store.setBatches(state);
    }
    const runId = submission.runId;
    for (const batchId of open) {
      const batch = await client.beta.messages.batches.retrieve(batchId);
      if (batch.processing_status !== "ended") {
        summary.pending += 1;
        opts.log(`Batch ${batchId} is still ${batch.processing_status}.`);
        continue;
      }
      await collectBatch(store, client, submission, runId, batchId, topics, summary, opts.log);
      submission.collected.push(batchId);
      await store.setBatches(state);
      opts.log(`Collected batch ${batchId}.`);
    }

    const fresh = await store.unclusteredStoryIds(runId);
    if (fresh.length) {
      opts.log(`Clustering ${fmt(fresh.length)} stories.`);
      await store.cluster(fresh, submission.kind);
    }
    const range = await store.runDateRange(runId);
    if (range) await store.refreshTrends(range.from, range.to);
  }
  opts.log(`Done ${summary.done}, failed ${summary.failed}, already done ${summary.skipped}, batches still running ${summary.pending}.`);
  return summary;
}

/** Refills empty clean_text from the stored raw email; the issues guard only allows this from ''. */
export async function reclean(
  store: BackfillStore,
  getRaw: (path: string) => Promise<Uint8Array | null>,
  opts: { log: Log },
): Promise<{ fixed: number; missing: number; empty: number }> {
  const out = { fixed: 0, missing: 0, empty: 0 };
  for (const { id, rawPath } of await store.emptyCleanIssues()) {
    const raw = await getRaw(rawPath);
    if (!raw) {
      out.missing += 1;
      opts.log(`${id}: raw email not found`);
      continue;
    }
    const text = cleanText(await parseEmail(raw));
    if (!text) {
      out.empty += 1;
      continue;
    }
    await store.setCleanText(id, text);
    out.fixed += 1;
  }
  return out;
}
