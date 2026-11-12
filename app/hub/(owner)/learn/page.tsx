import { LearnCards } from "@/components/hub/learn/LearnCards";
import { MinutesBar } from "@/components/hub/learn/MinutesBar";
import { requireOwner } from "@/lib/auth/require-owner";
import { masonTimeZone } from "@/lib/hub/events";
import { learnToday } from "@/lib/learn/day";
import { loadLearnDay } from "@/lib/learn/read";
import { serviceClient, sessionClient } from "@/lib/supabase/server";

export const metadata = { title: "Learn" };
// The answer actions run in this page's function, and grading an answer can take about a minute.
export const maxDuration = 120;

export default async function LearnPage() {
  await requireOwner();
  const date = learnToday(new Date(), await masonTimeZone(serviceClient()));
  const day = await loadLearnDay(await sessionClient(), date);

  if (day.cards.length === 0) {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Today&apos;s practice</h1>
        <p className="rounded-tile border-2 border-dashed border-line p-6 text-mute">Today&apos;s practice is not ready yet. It shows up by 05:30.</p>
        <MinutesBar earned={day.earned} />
      </main>
    );
  }
  return (
    <main>
      <LearnCards day={day} />
    </main>
  );
}
