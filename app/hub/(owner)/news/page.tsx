import Link from "next/link";
import { RetryIssueButton } from "@/components/hub/RetryIssueButton";
import { focusRing, panel, smallButton, sticker } from "@/components/hub/styles";
import type { ReactNode } from "react";
import { requireOwner } from "@/lib/auth/require-owner";
import { readNewsOverview, readPageCosts, type IssueRow } from "@/lib/news/reader";
import { serviceClient, sessionClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "News" };

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  processing: "Reading",
  done: "Done",
  failed: "Failed",
  quarantined: "Held back",
  backfill: "Backfill",
};

const usd = (n: number) => `$${n.toFixed(2)}`;

async function pausedMonth(): Promise<string | null> {
  const { data, error } = await serviceClient().from("hub_state").select("value").eq("key", "news:paused").maybeSingle();
  if (error) throw error;
  return typeof data?.value === "string" ? data.value : null;
}

export default async function NewsPage() {
  await requireOwner();
  const now = new Date();
  const costs = () => readPageCosts(serviceClient(), now);
  const overview = await readNewsOverview(await sessionClient(), now, { pausedMonth, costs }).catch(() => null);

  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">News</h1>
      <p className="mt-2 max-w-[60ch] text-mute">Newsletters that came in, what went wrong, and what the reading costs. Only you see this page.</p>

      {!overview ? (
        <p role="alert" className="mt-8 text-sm font-medium text-accent-ink">
          Could not load the news data. Try again in a minute.
        </p>
      ) : (
        <>
          <section aria-labelledby="costs" className={`${panel} mt-8 p-5 sm:p-6`}>
            <h2 id="costs" className="text-sm font-semibold text-ink">
              Cost this month
            </h2>
            {overview.paused && (
              <p className="mt-2 text-sm font-semibold text-accent-ink">Paused. The monthly cap was reached, so reading is off until next month.</p>
            )}
            {overview.costThisMonth === null ? (
              <p className="mt-2 text-sm text-mute">Costs could not be loaded. Try again in a minute.</p>
            ) : (
              <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="This month" value={usd(overview.costThisMonth)} />
                <Stat label="Last month" value={overview.costLastMonth === null ? "none" : usd(overview.costLastMonth)} />
                <Stat label="Per issue" value={overview.costPerIssue === null ? "none yet" : usd(overview.costPerIssue)} />
              </dl>
            )}
            <p className="mt-3 text-sm text-mute">
              Monthly cap <span className="font-semibold text-ink">{usd(overview.cap)}</span>
            </p>
          </section>

          <ListSection id="held" title="Held back" total={overview.quarantined.length} empty="Nothing held back.">
            {overview.quarantined.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/hub/news/quarantine/${q.id}`}
                  className={`${sticker} flex items-center justify-between gap-4 bg-surface px-4 py-3 transition-[translate] duration-200 ease-spring hover:-translate-y-px ${focusRing}`}
                >
                  <span className="min-w-0">
                    <span className="block leading-snug font-medium break-words text-ink">{q.subject || "No subject"}</span>
                    <span className="mt-1 block text-xs break-all text-mute">
                      {q.from || "Unknown sender"} · {timeAgo(q.receivedAt)}
                    </span>
                  </span>
                  <span className={`${smallButton} shrink-0`}>View</span>
                </Link>
              </li>
            ))}
          </ListSection>

          <section aria-labelledby="issues" className="mt-10">
            <h2 id="issues" className={sectionHeading}>
              Latest issues
            </h2>
            {overview.issues.length === 0 ? (
              <p className={emptyBox}>No issues yet.</p>
            ) : (
              <div className="grid gap-6">
                {overview.issues.map((s) => (
                  <section key={s.sourceId} aria-labelledby={`src-${s.sourceId}`}>
                    <h3 id={`src-${s.sourceId}`} className="mb-2 px-1 text-xs font-bold tracking-[0.04em] text-mute">
                      {s.sourceName}
                    </h3>
                    <ul className="grid gap-2.5">
                      {s.issues.map((i) => (
                        <IssueItem key={i.id} issue={i} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>

          <ListSection id="topics" title="Topics Claude suggested" total={overview.suggestedTopics.length} empty="No suggestions yet.">
            {overview.suggestedTopics.map((t) => (
              <li key={t.topic} className={`${sticker} flex items-center justify-between gap-4 bg-surface px-4 py-3`}>
                <span className="break-words text-ink">{t.topic}</span>
                <span className="font-mono text-sm text-mute">{t.count}</span>
              </li>
            ))}
          </ListSection>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-mute">{label}</dt>
      <dd className={`text-2xl tracking-tight text-ink ${value.startsWith("$") ? "font-mono font-medium" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}

const sectionHeading = "mb-3 flex items-baseline gap-2 px-1 text-sm font-semibold text-ink";
const emptyBox = "rounded-tile border-2 border-dashed border-line/40 px-5 py-4 text-sm text-mute";

function ListSection({ id, title, total, empty, children }: { id: string; title: string; total: number; empty: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className={sectionHeading}>
        {title}
        <span className="font-normal text-mute">{total}</span>
      </h2>
      {total === 0 ? <p className={emptyBox}>{empty}</p> : <ul className="grid gap-2.5">{children}</ul>}
    </section>
  );
}

function IssueItem({ issue }: { issue: IssueRow }) {
  return (
    <li className={`${sticker} flex flex-wrap items-start justify-between gap-x-4 gap-y-2 bg-surface px-4 py-3`}>
      <div className="min-w-0">
        <p className="leading-snug font-medium break-words text-ink">{issue.subject || "No subject"}</p>
        <p className="mt-1 text-xs text-mute">
          <span className="font-semibold text-ink">{STATUS_LABEL[issue.status] ?? issue.status}</span> · {timeAgo(issue.receivedAt)}
        </p>
        {issue.lastError && <p className="mt-1 text-sm break-words text-mute">{issue.lastError}</p>}
      </div>
      {issue.status === "failed" && <RetryIssueButton id={issue.id} />}
    </li>
  );
}
