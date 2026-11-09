import type { ReactNode } from "react";
import { DailyBars } from "@/components/hub/analytics/DailyBars";
import { panel } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { loadReport } from "@/lib/analytics/report";

export const metadata = { title: "Analytics" };

const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (iso: string) => shortDay.format(new Date(`${iso}T00:00:00Z`));
const n = (value: number | null | undefined) => (value ?? 0).toLocaleString();

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className={`${panel} p-5`}>
      <p className="text-sm font-medium text-mute">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{n(value)}</p>
      <p className="mt-1 text-xs text-mute">{note}</p>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={`${panel} p-5`} aria-label={title}>
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {note && <p className="mt-1 text-sm text-mute">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="rounded-tile border-2 border-dashed border-line/40 p-4 text-sm text-mute">{empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-mute">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`pb-2 font-medium ${i === head.length - 1 ? "text-right" : "pr-4"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-t-2 border-dashed border-line/30">
              {cells.map((cell, i) => (
                <td key={i} className={`py-2 ${i > 0 ? "whitespace-nowrap" : ""} ${i === cells.length - 1 ? "text-right tabular-nums" : "pr-4 text-ink"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage() {
  await requireOwner();
  const report = await loadReport(28);
  const ai = report.agents.filter((a) => a.kind === "ai");
  const search = report.agents.filter((a) => a.kind === "search");
  const agentRow = (a: (typeof report.agents)[number]) => [
    a.agent,
    Object.entries(a.byPath)
      .sort((x, y) => y[1] - x[1])
      .map(([path, hits]) => `${path} ${hits}`)
      .join(", "),
    day(a.lastSeen),
    n(a.hits),
  ];

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-mute">
          Last 7 days unless noted. Counts full page loads, so clicks from one page to another inside the site are not
          counted. Your own signed-in visits are not counted. No cookies, no IP addresses stored.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Visitor-days" value={report.week.visitors} note={`${n(report.week.views)} page views`} />
        <Tile label="/coffee visits" value={report.week.coffee} note="page views by people" />
        <Tile label="AI bot reads" value={report.week.aiReads} note="crawlers and agents" />
        <Tile label="From assistants" value={report.week.fromAssistants} note="ChatGPT, Claude, Perplexity…" />
      </div>

      <Section title="Every day" note="Last 28 days. Visitors are counted once per day, so a weekly total is visitor-days.">
        <div className="space-y-6">
          <DailyBars title="Visitors" unit="visitors" points={report.daily.map((d) => ({ day: d.day, value: d.visitors }))} />
          <DailyBars title="AI bot reads" unit="reads" points={report.daily.map((d) => ({ day: d.day, value: d.aiReads }))} />
          <details className="text-sm">
            <summary className="cursor-pointer text-mute">Show as a table</summary>
            <div className="mt-3">
              <Table
                head={["Day", "Page views", "AI reads", "Visitors"]}
                rows={[...report.daily].reverse().map((d) => [day(d.day), n(d.views), n(d.aiReads), n(d.visitors)])}
                empty="No days yet."
              />
            </div>
          </details>
        </div>
      </Section>

      <Section title="Pages">
        <Table
          head={["Page", "Bot reads", "Page views", "Visitors"]}
          rows={report.pages.map((p) => [p.path, n(p.botReads), n(p.views), n(p.visitors)])}
          empty="No visits this week."
        />
      </Section>

      <Section title="Who found /coffee" note="Last 28 days, people only, top 25 sources.">
        <Table
          head={["From", "Country", "Last seen", "Visits"]}
          rows={report.coffeeSources.map((c) => [
            c.fromAssistant ? `${c.fromAssistant} (${c.refHost || "link tag"})` : c.refHost || "direct or hidden",
            c.country || "unknown",
            day(c.lastDay),
            n(c.hits),
          ])}
          empty="Nobody has visited /coffee yet."
        />
      </Section>

      <Section title="People from AI assistants" note="Last 28 days, by referrer or utm_source.">
        <Table head={["Assistant", "Visits"]} rows={report.assistants.map((a) => [a.name, n(a.hits)])} empty="None yet." />
      </Section>

      <Section title="AI crawlers and agents" note="Last 28 days. These don't run JavaScript, so they're counted on the server.">
        <Table head={["Agent", "Pages read", "Last seen", "Reads"]} rows={ai.map(agentRow)} empty="No AI bots yet." />
      </Section>

      <Section title="Search engines" note="Last 28 days.">
        <Table head={["Crawler", "Pages read", "Last seen", "Reads"]} rows={search.map(agentRow)} empty="No search crawlers yet." />
      </Section>

      <Section title="Other referrers" note="Last 28 days, top 15 sites linking here.">
        <Table head={["Site", "Visits"]} rows={report.referrers.map((r) => [r.host, n(r.hits)])} empty="None yet." />
      </Section>

      <Section title="Unknown bots" note="Last 28 days, a sample of user agents the site doesn't recognize.">
        <Table
          head={["User agent", "Hits"]}
          rows={report.unknownBots.map((u) => [<code key="ua" className="break-all text-xs">{u.userAgent || "(no sample kept)"}</code>, n(u.hits)])}
          empty="None yet."
        />
      </Section>
    </main>
  );
}
