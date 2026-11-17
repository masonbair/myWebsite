import { WalkDeck } from "@/components/hub/WalkDeck";
import { requireOwner } from "@/lib/auth/require-owner";
import { buildDeck } from "@/lib/walk/deck";
import { todaysMemoCards } from "@/lib/walk/memo-cards";

export const metadata = { title: "Walk" };

export default async function WalkPage() {
  await requireOwner();
  const cards = buildDeck(await todaysMemoCards());
  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">Walk</h1>
      <p className="mt-2 mb-6 max-w-[60ch] text-mute">
        Read one, put the phone away, and start talking into the recorder. Works with no signal once you&apos;ve opened it here.
      </p>
      <WalkDeck cards={cards} />
    </main>
  );
}
