// Compares extraction models on recent real issues; output stays in the git-ignored .news-compare/ folder.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { costOf, type ModelId } from "../lib/ai/claude";
import { COMPARE_SOURCES, interleaveJobs, parseTopicSeed, pickIssues, passesRule, SpendGuard, summarize, worstCaseUsd, type CompareIssue, type IssueRun } from "../lib/news/compare";
import { cleanText, parseEmail } from "../lib/news/email";
import { buildExtractRequest, ExtractError, extractIssue, type ExtractedStory, type ModelCharge } from "../lib/news/extract";
import type { Topic } from "../lib/news/prompt";
import { readMbox } from "./news-mbox";

const USAGE = "usage: npm run news:compare -- <estimate|run> --mbox <path> [--max-usd 6 (hard cap, checked against worst-case estimates before each call)] [--stop-at <ISO time>]";
const MODELS: { id: ModelId; effort: "low" | "medium" }[] = [
  { id: "claude-opus-5-5", effort: "medium" },
  { id: "claude-sonnet-5-5", effort: "low" },
  { id: "claude-haiku-5-5", effort: "low" },
];
const REFERENCE: ModelId = "claude-opus-5-5";
const OUTPUT_TOKENS_PER_ISSUE = 2_500;
const PARALLEL = 4;
const OUT_DIR = ".news-compare";

class UsageError extends Error {}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

const usd = (n: number) => `$${n.toFixed(3)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const log = (line: string) => console.log(line);

async function topics(): Promise<Topic[]> {
  const list = parseTopicSeed(await readFile("supabase/migrations/0010_news_topics_cron.sql", "utf8"));
  if (list.length !== 30) throw new Error(`expected 30 seeded topics, found ${list.length}`);
  return list;
}

const senders = new Map<string, string>(COMPARE_SOURCES.map((s) => [s.address, s.name]));
const HEAD_BYTES = 16_384;

async function loadIssues(mbox: string): Promise<CompareIssue[]> {
  const found: CompareIssue[] = [];
  for await (const raw of readMbox(mbox)) {
    // Full parsing is slow, so skip messages whose headers name none of the senders.
    const head = new TextDecoder("latin1").decode(raw.subarray(0, HEAD_BYTES)).toLowerCase();
    if (![...senders.keys()].some((a) => head.includes(a))) continue;
    const email = await parseEmail(raw);
    const sourceName = senders.get(email.from);
    if (!sourceName || !email.date) continue;
    const text = cleanText(email);
    found.push({ sourceName, messageId: email.messageId, subject: email.subject, date: email.date, text });
  }
  const picked = pickIssues(found);
  for (const s of COMPARE_SOURCES) log(`  ${s.name}: ${picked.filter((i) => i.sourceName === s.name).length} of ${found.filter((i) => i.sourceName === s.name).length}`);
  return picked;
}

const input = (issue: CompareIssue) => ({
  sourceName: issue.sourceName,
  subject: issue.subject,
  publishedOn: issue.date.toISOString().slice(0, 10),
  text: issue.text,
});

async function estimate(client: Anthropic, issues: CompareIssue[], topicList: Topic[]): Promise<void> {
  let total = 0;
  for (const { id } of MODELS) {
    let inputTokens = 0;
    for (const issue of issues) {
      const { model, system, messages, output_config } = buildExtractRequest(input(issue), id, topicList);
      inputTokens += (await client.beta.messages.countTokens({ model, system, messages, output_config })).input_tokens;
    }
    const outputTokens = OUTPUT_TOKENS_PER_ISSUE * issues.length;
    const cost = costOf(id, { input_tokens: inputTokens, output_tokens: outputTokens });
    total += cost;
    log(`${id}: ${inputTokens.toLocaleString("en-US")} input + ${outputTokens.toLocaleString("en-US")} output tokens = ${usd(cost)}`);
  }
  log(`Total for ${issues.length} issues x ${MODELS.length} models: ${usd(total)} (no cache discount assumed)`);
}

/** Sets the effort on every request, since buildExtractRequest always asks for low. */
function withEffort(client: Anthropic, effort: "low" | "medium"): Anthropic {
  const messages = client.beta.messages;
  const create: typeof messages.create = ((req: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, opts?: Anthropic.RequestOptions) =>
    messages.create({ ...req, output_config: { ...req.output_config, effort } }, opts)) as typeof messages.create;
  return { beta: { messages: { create } } } as unknown as Anthropic;
}

const chargeCost = (charges: ModelCharge[]) => charges.reduce((sum, c) => sum + costOf(c.model, c.usage), 0);

type RunRow = IssueRun & { error: string | null; servedBy: string[] };
/** Hard cap: a call starts only if spent + in-flight worst case + its own worst case stays within maxUsd; also stops at stopAt. */
type Limits = { maxUsd: number; stopAt: Date };
const SKIPPED: RunRow = { stories: null, costUsd: 0, error: "not run (spend cap or stop time reached)", servedBy: [] };

async function runAll(client: Anthropic, issues: CompareIssue[], topicList: Topic[], limits: Limits): Promise<Record<ModelId, RunRow[]>> {
  const jobs = interleaveJobs(MODELS, issues.length);
  const results = Object.fromEntries(MODELS.map((m) => [m.id, issues.map(() => SKIPPED)])) as Record<ModelId, RunRow[]>;
  const guard = new SpendGuard(limits.maxUsd);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const { m, i } = jobs[next];
      const issue = issues[i];
      const req = buildExtractRequest(input(issue), m.id, topicList);
      const inputChars = req.messages.reduce((n, msg) => n + String(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)).length, 0) + JSON.stringify(req.system).length;
      const reserve = worstCaseUsd(m.id, inputChars, req.max_tokens);
      if (Date.now() >= limits.stopAt.getTime() || !guard.tryReserve(reserve)) {
        log(`Stopping: spent ${usd(guard.spent)}, ${jobs.length - next} calls not started`);
        next = jobs.length;
        return;
      }
      next += 1;
      let row: RunRow;
      try {
        const r = await extractIssue(input(issue), { client: withEffort(client, m.effort), model: m.id, topics: topicList });
        row = { stories: r.stories, costUsd: chargeCost(r.charges), error: null, servedBy: r.charges.map((c) => c.model) };
      } catch (e) {
        const charges = e instanceof ExtractError ? e.charges : [];
        row = { stories: null, costUsd: chargeCost(charges), error: e instanceof Error ? e.message : String(e), servedBy: charges.map((c) => c.model) };
      }
      guard.settle(reserve, row.costUsd);
      results[m.id][i] = row;
      done += 1;
      log(`${done}/${jobs.length} ${m.id} issue ${i + 1}: ${row.stories ? `${row.stories.length} stories` : "failed"}, ${usd(row.costUsd)}`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return results;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function storyHtml(s: ExtractedStory): string {
  const companies = s.companies.map((c) => esc(c.ticker ? `${c.name} (${c.ticker})` : c.name)).join(", ");
  return `<li><b>${esc(s.headline)}</b><br><small>${esc(s.kind)} | tone ${s.sentiment} | ${esc(s.topics.join(", ") || "no topic")}${s.suggestedTopic ? ` | suggests ${esc(s.suggestedTopic)}` : ""}${companies ? ` | ${companies}` : ""}</small></li>`;
}

function page(issues: CompareIssue[], results: Record<ModelId, RunRow[]>, summaryRows: string[][]): string {
  const head = `<tr>${["Model", "Stories", "Opus stories found", "Topic agreement", "Ticker agreement", "Failed", "Cost per issue", "Total"].map((h) => `<th>${h}</th>`).join("")}</tr>`;
  const summary = summaryRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  const sections = issues
    .map((issue, i) => {
      const cols = MODELS.map(({ id }) => {
        const row = results[id][i];
        const body = row.stories ? `<ol>${row.stories.map(storyHtml).join("")}</ol>` : `<p>Failed: ${esc(row.error ?? "")}</p>`;
        return `<td><h3>${id} <small>${usd(row.costUsd)}</small></h3>${body}</td>`;
      }).join("");
      return `<h2>${esc(issue.sourceName)}, ${issue.date.toISOString().slice(0, 10)}: ${esc(issue.subject)}</h2><table class="side"><tr>${cols}</tr></table>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Model comparison</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}.side td{width:33%}li{margin-bottom:6px}</style><h1>Model comparison (reference ${REFERENCE})</h1><table>${head}${summary}</table>${sections}`;
}

async function run(client: Anthropic, issues: CompareIssue[], topicList: Topic[], limits: Limits): Promise<void> {
  const results = await runAll(client, issues, topicList, limits);
  const rows: string[][] = [];
  const summaries: Record<string, ReturnType<typeof summarize>> = {};
  for (const { id } of MODELS) {
    const s = summarize(results[id], results[REFERENCE]);
    summaries[id] = s;
    rows.push([id, String(s.stories), `${s.found}/${s.referenceStories} (${pct(s.foundRate)})`, pct(s.topicAgreement), `${pct(s.tickerAgreement)} of ${s.tickerPairs}`, String(s.failed), usd(s.costPerIssue), usd(s.costUsd)]);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const issueMeta = issues.map((i) => ({ sourceName: i.sourceName, date: i.date.toISOString(), subject: i.subject }));
  await writeFile(`${OUT_DIR}/results.json`, JSON.stringify({ issues: issueMeta, results, summaries }, null, 2));
  await writeFile(`${OUT_DIR}/index.html`, page(issues, results, rows));
  log("\nmodel | stories | Opus stories found | topic agreement | ticker agreement | failed | per issue | total");
  for (const r of rows) log(r.join(" | "));
  const total = Object.values(summaries).reduce((sum, s) => sum + s.costUsd, 0);
  log(`Total spent: ${usd(total)}`);
  const pick = MODELS.find(({ id }) => id !== REFERENCE && passesRule(summaries[id]));
  log(`Cheapest model meeting the rule: ${pick?.id ?? "none (keep the default)"}`);
  log(`Wrote ${OUT_DIR}/index.html and ${OUT_DIR}/results.json`);
}

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  const mbox = flag(argv, "--mbox");
  if ((command !== "estimate" && command !== "run") || !mbox) throw new UsageError(USAGE);
  process.loadEnvFile(".env.local");
  const apiKey = process.env.ANTHROPIC_API_KEY_NEWS;
  if (!apiKey) throw new UsageError("ANTHROPIC_API_KEY_NEWS is not set in .env.local");
  const client = new Anthropic({ apiKey });
  const topicList = await topics();
  log("Picking issues:");
  const issues = await loadIssues(mbox);
  if (command === "estimate") await estimate(client, issues, topicList);
  else {
    const maxUsd = Number(flag(argv, "--max-usd") ?? 6);
    const stopAt = new Date(flag(argv, "--stop-at") ?? Date.now() + 45 * 60_000);
    if (!(maxUsd > 0) || Number.isNaN(stopAt.getTime())) throw new UsageError("--max-usd needs a number and --stop-at an ISO time");
    await run(client, issues, topicList, { maxUsd, stopAt });
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof UsageError ? e.message : `${e instanceof Error ? e.name : "Error"}: comparison failed`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
