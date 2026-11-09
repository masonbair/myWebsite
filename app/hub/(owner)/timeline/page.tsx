import { GitBranch, GitCommit } from "@phosphor-icons/react/dist/ssr";
import { panel } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { listTimeline, type TimelineDay, type TimelineEntry } from "@/lib/hub/timeline";
import { sessionClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Timeline" };

export default async function TimelinePage() {
  await requireOwner();
  const days = await listTimeline(await sessionClient()).catch(() => null);

  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">Timeline</h1>
      <p className="mt-2 max-w-[60ch] text-mute">What got done each day, project by project. Claude writes it from the day&apos;s commits and updates today as work lands.</p>
      <div className="mt-8">
        {!days ? (
          <p className="text-sm text-mute">Could not reach the database, so the timeline cannot load right now.</p>
        ) : days.length === 0 ? (
          <p className="text-sm text-mute">Nothing logged yet. Run the daily-log skill in Claude Code to add today.</p>
        ) : (
          <ol className="flex flex-col gap-10">
            {days.map((day) => (
              <Day key={day.day} day={day} />
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Day({ day }: { day: TimelineDay }) {
  const commits = day.entries.reduce((sum, e) => sum + e.commits, 0);
  const headingId = `day-${day.day}`;
  return (
    <li>
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="mb-1 px-1 text-lg font-semibold tracking-tight text-ink">
          <time dateTime={day.day}>{dayLabel(day.day)}</time>
        </h2>
        <p className="mb-4 px-1 text-sm text-mute">
          {day.entries.length} {day.entries.length === 1 ? "project" : "projects"} · {commits} {commits === 1 ? "commit" : "commits"}
        </p>
        <ul className="flex flex-col gap-3 border-l-[2.5px] border-line/30 pl-4 sm:pl-5">
          {day.entries.map((entry) => (
            <Entry key={entry.project} entry={entry} />
          ))}
        </ul>
      </section>
    </li>
  );
}

function Entry({ entry }: { entry: TimelineEntry }) {
  return (
    <li className={`${panel} p-4 sm:p-5`}>
      <h3 className="text-base font-bold tracking-tight text-ink">{entry.project}</h3>
      <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-pretty whitespace-pre-line text-ink">{entry.summary}</p>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
        <span className="inline-flex items-center gap-1">
          <GitCommit size={14} aria-hidden />
          {entry.commits} {entry.commits === 1 ? "commit" : "commits"}
        </span>
        {entry.branches.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <GitBranch size={14} aria-hidden />
            <span className="break-all">{entry.branches.join(", ")}</span>
          </span>
        )}
        <span>Updated {timeAgo(entry.updatedAt)}</span>
      </p>
    </li>
  );
}
