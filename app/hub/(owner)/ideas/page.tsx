import { GearSix } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { IdeaRow } from "@/components/hub/ideas/IdeaRow";
import { focusRing } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { FailedSources } from "@/components/hub/ideas/FailedSources";
import { IDEA_FILTERS, listFailedSources, listIdeas, type IdeaFilter } from "@/lib/ideas/read";
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
  const client = await sessionClient();
  const [{ ideas, total }, failed] = await Promise.all([listIdeas(client, filter), listFailedSources(client)]);

  return (
    <main>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Ideas Lab</h1>
        <Link
          href="/hub/ideas/settings"
          className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-mute transition-colors duration-300 ease-spring hover:text-ink hover:underline ${focusRing}`}
        >
          <GearSix size={16} weight="bold" aria-hidden />
          Settings
        </Link>
      </div>
      <p className="mt-2 max-w-[60ch] text-sm text-mute">Each idea gets an honest review, then comes back on your calendar.</p>

      {failed.length > 0 && <FailedSources sources={failed} />}

      <nav aria-label="Idea filters" className="mt-6">
        <ul className="flex flex-wrap gap-1.5">
          {IDEA_FILTERS.map((name) => {
            const current = name === filter;
            return (
              <li key={name}>
                <Link
                  href={name === "active" ? "/hub/ideas" : `/hub/ideas?show=${name}`}
                  aria-current={current ? "page" : undefined}
                  className={`block rounded-full border-2 border-line px-3 py-1 text-sm font-bold transition-colors duration-200 ease-spring sm:px-3.5 ${
                    current ? "bg-ink text-canvas" : "bg-surface text-ink hover:bg-canvas"
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
          <ul className="grid gap-2.5">
            {ideas.map((idea) => (
              <IdeaRow key={idea.id} idea={idea} />
            ))}
          </ul>
        ) : (
          <div className="rounded-tile border-2 border-dashed border-line/40 px-5 py-6">
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
