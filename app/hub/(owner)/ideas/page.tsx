import Link from "next/link";
import { IdeaRow } from "@/components/hub/ideas/IdeaRow";
import { focusRing } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { IDEA_FILTERS, listIdeas, type IdeaFilter } from "@/lib/ideas/read";
import { sessionClient } from "@/lib/supabase/server";

export const metadata = { title: "Ideas Lab" };

const FILTER_NAMES: Record<IdeaFilter, string> = { active: "Active", stopped: "Stopped", promoted: "Promoted", done: "Done" };

const EMPTY: Record<IdeaFilter, string> = {
  active: "No active ideas yet.",
  stopped: "No ideas with reminders stopped.",
  promoted: "No ideas promoted to tasks yet.",
  done: "No finished ideas yet.",
};

function isFilter(value: unknown): value is IdeaFilter {
  return typeof value === "string" && (IDEA_FILTERS as readonly string[]).includes(value);
}

export default async function IdeasPage({ searchParams }: PageProps<"/hub/ideas">) {
  await requireOwner("/hub/ideas");
  const { show } = await searchParams;
  const filter: IdeaFilter = isFilter(show) ? show : "active";
  const { ideas, total } = await listIdeas(await sessionClient(), filter);

  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">Ideas Lab</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-mute">Each idea gets an honest review, then comes back on your calendar.</p>

      <nav aria-label="Idea filters" className="mt-6 -mx-1 overflow-x-auto px-1">
        <ul className="inline-flex rounded-full bg-ink/5 p-1">
          {IDEA_FILTERS.map((name) => {
            const current = name === filter;
            return (
              <li key={name}>
                <Link
                  href={name === "active" ? "/hub/ideas" : `/hub/ideas?show=${name}`}
                  aria-current={current ? "page" : undefined}
                  className={`block rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-300 ease-spring sm:px-4 ${
                    current ? "bg-surface text-ink shadow-sm ring-1 ring-ink/5" : "text-mute hover:text-ink"
                  } ${focusRing}`}
                >
                  {FILTER_NAMES[name]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="ideas-list" className="mt-6">
        <h2 id="ideas-list" className="mb-3 flex items-baseline gap-2 px-1 text-sm font-semibold text-ink">
          {FILTER_NAMES[filter]}
          <span className="font-normal text-mute">{total}</span>
        </h2>
        {total > ideas.length && (
          <p className="mb-3 px-1 text-sm text-mute">
            Showing {ideas.length} of {total}, newest first.
          </p>
        )}
        {ideas.length > 0 ? (
          <ul className="divide-y divide-ink/[0.06] overflow-hidden rounded-tile bg-surface shadow-tile ring-1 ring-ink/5">
            {ideas.map((idea) => (
              <IdeaRow key={idea.id} idea={idea} />
            ))}
          </ul>
        ) : (
          <div className="rounded-tile px-5 py-6 ring-1 ring-ink/10 ring-inset">
            <p className="text-sm font-medium text-ink">{EMPTY[filter]}</p>
            {filter === "active" && (
              <p className="mt-1 text-sm text-mute">
                Write one on{" "}
                <Link href="/hub/capture" className={`font-semibold text-accent-ink underline-offset-4 hover:underline ${focusRing}`}>
                  Capture
                </Link>{" "}
                and tap Save as idea. Ideas in your inbox are found and moved here too.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
