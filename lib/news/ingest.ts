import { matchSource, parseEmail, cleanText, sha256Hex, type ParsedEmail } from "./email";
import type { IssueStatus, NewIssue, NewsSource } from "./types";

export type IngestDeps = {
  sources(): Promise<NewsSource[]>;
  /** Must be overwrite-safe: the same path can be written again on a retry. */
  putRaw(path: string, raw: Uint8Array): Promise<void>;
  insertIssue(row: NewIssue): Promise<{ id: string } | null>;
  findIssueId(messageId: string): Promise<string | null>;
  timeZone: string;
};

/** `dkimFrom` is the From address an aligned DKIM pass proved; it must equal the From this parser reads. */
export type IngestVia = { kind: "webhook"; forwardedOk: boolean; dkimFrom: string | null } | { kind: "backfill" };

export type IngestResult = { status: "created" | "duplicate"; id: string; issueStatus: IssueStatus };

function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function httpsUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const DB_PUBLIC_URL = /^https:\/\/[^\s?#"'<>]+$/;
const MAX_MESSAGE_ID = 1000;
const MAX_SUBJECT = 1000;
const MAX_FROM = 320;

function plainUrl(url: URL): string | null {
  return DB_PUBLIC_URL.test(url.href) ? url.href : null;
}

function candidateLinks(email: ParsedEmail): string[] {
  const links: string[] = [];
  const header = email.listPost?.match(/<([^>]+)>/)?.[1] ?? email.listPost;
  if (header) links.push(header);
  for (const m of (email.html ?? "").matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]*>/g, " ");
    if (/view\s+(this\s+)?(email\s+)?(online|in\s+(your\s+|a\s+)?browser)|read\s+online/i.test(label)) links.push(m[1]);
  }
  return links;
}

function slugFrom(email: ParsedEmail, host: string): string | null {
  for (const link of candidateLinks(email)) {
    const url = httpsUrl(link.replace(/&amp;/g, "&"));
    if (!url || url.hostname !== host || url.search) continue;
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length || segments.some((s) => /^[A-Za-z0-9_-]{32,}$/.test(s))) continue;
    return segments[segments.length - 1];
  }
  return null;
}

/** Fills the source's archive_pattern ({yyyy} {mm} {dd} {slug}) or falls back to its homepage; never returns a query or fragment. */
export function publicIssueUrl(source: NewsSource, email: ParsedEmail, publishedOn: string | null): string | null {
  const fallbackUrl = httpsUrl(source.homepage);
  const fallback = fallbackUrl ? plainUrl(fallbackUrl) : null;
  const pattern = source.archivePattern;
  if (!pattern) return fallback;

  const patternHost = httpsUrl(pattern.replace(/\{[a-z]+\}/g, "x"))?.hostname;
  if (!patternHost) return fallback;

  const [yyyy, mm, dd] = publishedOn?.split("-") ?? [];
  let slug: string | null = null;
  let filled = true;
  const result = pattern.replace(/\{(yyyy|mm|dd|slug)\}/g, (_, key: string) => {
    let value: string | null | undefined;
    if (key === "yyyy") value = yyyy;
    else if (key === "mm") value = mm;
    else if (key === "dd") value = dd;
    else value = slug ??= slugFrom(email, patternHost);
    if (!value) filled = false;
    return value ?? "";
  });
  if (!filled || /\{[a-z]+\}/.test(result)) return fallback;
  const url = httpsUrl(result);
  return (url && plainUrl(url)) ?? fallback;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export async function ingestEmail(raw: Uint8Array, deps: IngestDeps, via: IngestVia): Promise<IngestResult> {
  const errors: string[] = [];
  let email: ParsedEmail | null = null;
  try {
    email = await parseEmail(raw);
  } catch (error) {
    errors.push(`parse: ${reason(error)}`);
  }

  let messageId = email?.messageId ?? `sha256:${sha256Hex(raw)}`;
  if (messageId.length > MAX_MESSAGE_ID) messageId = `sha256:${sha256Hex(messageId)}`;

  const source = email ? matchSource(email.from, await deps.sources()) : null;
  let issueStatus: IssueStatus;
  if (!email) issueStatus = "quarantined";
  else if (via.kind === "webhook") issueStatus = via.forwardedOk && via.dkimFrom === email.from && source ? "pending" : "quarantined";
  else issueStatus = source ? "backfill" : "quarantined";

  const existing = await deps.findIssueId(messageId);
  if (existing) return { status: "duplicate", id: existing, issueStatus };

  const date = email?.date ?? null;
  const rawPath = date
    ? `news/raw/${dayIn(date, "UTC").slice(0, 4)}/${dayIn(date, "UTC").slice(5, 7)}/${sha256Hex(messageId)}.eml`
    : `news/raw/undated/${sha256Hex(messageId)}.eml`;
  await deps.putRaw(rawPath, raw);

  let publishedOn: string | null = null;
  let clean = "";
  let publicUrl: string | null = null;
  if (email) {
    try {
      publishedOn = date ? dayIn(date, deps.timeZone) : null;
    } catch (error) {
      errors.push(`date: ${reason(error)}`);
    }
    try {
      clean = cleanText(email);
    } catch (error) {
      errors.push(`clean: ${reason(error)}`);
    }
    try {
      publicUrl = source ? publicIssueUrl(source, email, publishedOn) : null;
    } catch (error) {
      errors.push(`url: ${reason(error)}`);
    }
  }

  const row: NewIssue = {
    sourceId: source?.id ?? null,
    messageId,
    subject: (email?.subject ?? "").slice(0, MAX_SUBJECT),
    fromAddress: (email?.from ?? "").slice(0, MAX_FROM),
    receivedAt: (date ?? new Date()).toISOString(),
    publishedOn,
    rawPath,
    cleanText: clean,
    publicUrl,
    status: issueStatus,
    lastError: errors.length ? errors.join("; ").slice(0, 500) : null,
  };
  const inserted = await deps.insertIssue(row);
  if (inserted) return { status: "created", id: inserted.id, issueStatus };

  const winner = await deps.findIssueId(messageId);
  if (!winner) throw new Error("issue insert conflicted but no row found");
  return { status: "duplicate", id: winner, issueStatus };
}
