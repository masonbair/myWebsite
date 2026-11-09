import Link from "next/link";
import { RetryIssueButton } from "@/components/hub/RetryIssueButton";
import { focusRing, panel } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { readNewsOverview, type IssueRow } from "@/lib/news/reader";
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
  const overview = await readNewsOverview(await sessionClient(), new Date(), { pausedMonth }).catch(() => null);

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
            <h2 id="costs" className="text-sm font-semibold text-mute">
              Cost this month
            </h2>
            {overview.paused && (
              <p className="mt-2 text-sm font-semibold text-accent-ink">Paused. The monthly cap was reached, so reading is off until next month.</p>
            )}
            {overview.costThisMonth === null ? (
              <p className="mt-2 text-sm text-mute">Costs show once the shared cost log is live.</p>
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

          <section aria-labelledby="held" className="mt-10">
            <h2 id="held" className="mb-4 px-1 text-lg font-semibold tracking-tight text-ink">
              Held back
            </h2>
            {overview.quarantined.length === 0 ? (
              <p className="px-1 text-sm text-mute">Nothing held back.</p>
            ) : (
              <ul className={`${panel} divide-y divide-ink/5`}>
                {overview.quarantined.map((q) => (
                  <li key={q.id}>
                    <Link
                      href={`/hub/news/quarantine/${q.id}`}
                      className={`flex items-center justify-between gap-4 rounded-tile px-5 py-4 hover:bg-ink/5 sm:px-6 ${focusRing}`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium break-words text-ink">{q.subject || "No subject"}</span>
                        <span className="block text-sm break-all text-mute">
                          {q.from || "Unknown sender"} · {timeAgo(q.receivedAt)}
                        </span>
                      </span>
                      <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink/5 px-3.5 text-sm font-medium text-ink">
                        View
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="issues" className="mt-10">
            <h2 id="issues" className="mb-4 px-1 text-lg font-semibold tracking-tight text-ink">
              Latest issues
            </h2>
            {overview.issues.length === 0 ? (
              <p className="px-1 text-sm text-mute">No issues yet.</p>
            ) : (
              <div className="grid gap-4">
                {overview.issues.map((s) => (
                  <section key={s.sourceId} aria-labelledby={`src-${s.sourceId}`} className={`${panel} p-5 sm:p-6`}>
                    <h3 id={`src-${s.sourceId}`} className="text-sm font-semibold text-mute">
                      {s.sourceName}
                    </h3>
                    <ul className="mt-3 divide-y divide-ink/5">
                      {s.issues.map((i) => (
                        <IssueItem key={i.id} issue={i} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="topics" className="mt-10">
            <h2 id="topics" className="mb-4 px-1 text-lg font-semibold tracking-tight text-ink">
              Topics Claude suggested
            </h2>
            {overview.suggestedTopics.length === 0 ? (
              <p className="px-1 text-sm text-mute">No suggestions yet.</p>
            ) : (
              <ul className={`${panel} divide-y divide-ink/5`}>
                {overview.suggestedTopics.map((t) => (
                  <li key={t.topic} className="flex items-center justify-between gap-4 px-5 py-3 sm:px-6">
                    <span className="break-words text-ink">{t.topic}</span>
                    <span className="text-sm text-mute">{t.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-mute">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight text-ink">{value}</dd>
    </div>
  );
}

function IssueItem({ issue }: { issue: IssueRow }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <p className="font-medium break-words text-ink">{issue.subject || "No subject"}</p>
        <p className="text-sm text-mute">
          <span className="font-semibold text-ink">{STATUS_LABEL[issue.status] ?? issue.status}</span> · {timeAgo(issue.receivedAt)}
        </p>
        {issue.lastError && <p className="mt-1 text-sm break-words text-mute">{issue.lastError}</p>}
      </div>
      {issue.status === "failed" && <RetryIssueButton id={issue.id} />}
    </li>
  );
}
