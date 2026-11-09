import { matchSource, parseEmail, cleanText, sha256Hex, type ParsedEmail } from "./email";
import type { IssueStatus, NewIssue, NewsSource } from "./types";

export type IngestDeps = {
  sources(): Promise<NewsSource[]>;
  putRaw(path: string, raw: Uint8Array): Promise<void>;
  insertIssue(row: NewIssue): Promise<{ id: string } | null>;
  findIssueId(messageId: string): Promise<string | null>;
  timeZone: string;
};

export type IngestVia = { kind: "webhook"; forwardedOk: boolean; dkimPass: boolean } | { kind: "backfill" };

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

function plainUrl(url: URL): string | null {
  return url.search || url.hash ? null : url.href;
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

export async function ingestEmail(raw: Uint8Array, deps: IngestDeps, via: IngestVia): Promise<IngestResult> {
  const email = await parseEmail(raw);

  const source = matchSource(email.from, await deps.sources());
  let issueStatus: IssueStatus;
  if (via.kind === "webhook") {
    issueStatus = via.forwardedOk && via.dkimPass && source ? "pending" : "quarantined";
  } else {
    issueStatus = source ? "backfill" : "quarantined";
  }

  const existing = await deps.findIssueId(email.messageId);
  if (existing) return { status: "duplicate", id: existing, issueStatus };

  const when = email.date ?? new Date();
  const [year, month] = dayIn(when, "UTC").split("-");
  const rawPath = `news/raw/${year}/${month}/${sha256Hex(email.messageId)}.eml`;
  const publishedOn = email.date ? dayIn(email.date, deps.timeZone) : null;

  await deps.putRaw(rawPath, raw);
  const row: NewIssue = {
    sourceId: source?.id ?? null,
    messageId: email.messageId,
    subject: email.subject,
    fromAddress: email.from,
    receivedAt: when.toISOString(),
    publishedOn,
    rawPath,
    cleanText: cleanText(email),
    publicUrl: source ? publicIssueUrl(source, email, publishedOn) : null,
    status: issueStatus,
  };
  const inserted = await deps.insertIssue(row);
  if (inserted) return { status: "created", id: inserted.id, issueStatus };

  const winner = await deps.findIssueId(email.messageId);
  if (!winner) throw new Error("issue insert conflicted but no row found");
  return { status: "duplicate", id: winner, issueStatus };
}
