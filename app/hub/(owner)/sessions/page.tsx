import { GitBranch } from "@phosphor-icons/react/dist/ssr";
import { AutoRefresh } from "@/components/hub/AutoRefresh";
import { panel } from "@/components/hub/styles";
import { tag } from "@/components/ui/sticker";
import { requireOwner } from "@/lib/auth/require-owner";
import { listQueuedSessions, type SessionRow } from "@/lib/hub/sessions";
import { sessionClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Sessions" };

export default async function SessionsPage() {
  await requireOwner();
  const sessions = await listQueuedSessions(await sessionClient()).catch(() => null);
  const waiting = sessions?.filter((s) => s.state === "needs_you" && !s.endedAt).length ?? 0;

  return (
    <main>
      <AutoRefresh seconds={30} />
      <h1 className="text-3xl font-semibold tracking-tight">Sessions</h1>
      <p className="mt-2 max-w-[60ch] text-mute">
        Claude Code sessions on the laptop that finished something big or are waiting on you. Small fixes and follow-up suggestions stay off this list.
      </p>
      <div className="mt-8">
        {!sessions ? (
          <p className="text-sm text-mute">Could not reach the database, so sessions cannot load right now.</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-mute">Nothing needs you. Sessions show up here when they finish big work or get stuck on a decision.</p>
        ) : (
          <>
            <p className="mb-4 px-1 text-sm font-semibold text-ink" aria-live="polite">
              {waiting === 0 ? "Nothing waiting on you" : `${waiting} waiting on you`}
            </p>
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => (
                <Session key={s.sessionId} session={s} />
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function Session({ session }: { session: SessionRow }) {
  const needsYou = session.state === "needs_you";
  return (
    <li className={`${panel} p-4 sm:p-5 ${session.endedAt ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${tag} border-line text-[11px] text-night ${needsYou ? "bg-tea" : "bg-accent"}`}>{needsYou ? "Needs you" : "Done"}</span>
        {session.endedAt && <span className={`${tag} border-line bg-surface text-[11px] text-mute`}>Closed</span>}
        <h2 className="text-base font-bold tracking-tight text-ink">{session.project}</h2>
        <time dateTime={session.updatedAt} className="ml-auto text-xs text-mute">
          {timeAgo(session.updatedAt)}
        </time>
      </div>
      <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-pretty text-ink">{session.line}</p>
      {session.branch && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-mute">
          <GitBranch size={14} aria-hidden />
          {session.branch}
        </p>
      )}
    </li>
  );
}
