import { Cookie, MapPin } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import type { ReactNode } from "react";
import { BakeForm } from "@/components/hub/BakeForm";
import { PlacePrivacySwitch } from "@/components/hub/PlacePrivacySwitch";
import { panel } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { MAX_BAKE_NAME } from "@/lib/hub/now-input";
import { formatLocation } from "@/lib/location";
import { loadNow, type Bake, type Place } from "@/lib/now";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Now" };

export default async function NowPage() {
  await requireOwner();
  const now = await loadNow();

  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">Now</h1>
      <p className="mt-2 max-w-[60ch] text-mute">What the Right Now board on the site shows. Changes here show up there right away.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Section id="place" icon={<MapPin size={18} weight="light" aria-hidden />} title="Current place">
          {now.place ? <PlaceCard place={now.place} /> : <p className="text-sm text-mute">No place yet. The phone will send one once it is set up.</p>}
        </Section>
        <Section id="last-bake" icon={<Cookie size={18} weight="light" aria-hidden />} title="Last bake">
          {now.bake ? <BakeCard bake={now.bake} /> : <p className="text-sm text-mute">No bake logged yet.</p>}
        </Section>
      </div>

      <section aria-labelledby="log-bake" className="mt-10">
        <h2 id="log-bake" className="mb-4 px-1 text-lg font-semibold tracking-tight text-ink">
          Log a bake
        </h2>
        <div className={`${panel} p-5 sm:p-6`}>
          <BakeForm maxName={MAX_BAKE_NAME} />
        </div>
      </section>
    </main>
  );
}

function Section({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${panel} flex flex-col gap-4 p-5 sm:p-6`}>
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-mute">
        <span className="grid size-8 place-items-center rounded-full bg-accent/15 text-accent-ink">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function PlaceCard({ place }: { place: Place }) {
  const full = [place.city, place.region, place.country].filter(Boolean).join(", ");
  return (
    <>
      <div>
        <p className="text-2xl leading-tight font-semibold tracking-tight text-balance text-ink">{full}</p>
        <p className="mt-1 text-sm text-mute">Updated {timeAgo(place.updatedAt)}</p>
      </div>
      <p className="rounded-2xl bg-canvas px-4 py-3 text-sm text-mute ring-1 ring-ink/5">
        The site shows <span className="font-semibold text-ink">{formatLocation(place)}</span>
      </p>
      <PlacePrivacySwitch isPrivate={place.private} />
    </>
  );
}

function BakeCard({ bake }: { bake: Bake }) {
  return (
    <div className="flex items-center gap-4">
      {bake.photo && (
        <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl ring-1 ring-ink/5">
          <Image src={bake.photo} alt={bake.name} fill sizes="80px" className="object-cover" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-2xl leading-tight font-semibold tracking-tight break-words text-ink">{bake.name}</p>
        <p className="mt-1 text-sm text-mute">
          Baked <time dateTime={bake.bakedAt}>{timeAgo(bake.bakedAt)}</time>
        </p>
      </div>
    </div>
  );
}
