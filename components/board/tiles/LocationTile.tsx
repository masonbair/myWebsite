import { formatLocation } from "@/lib/location";
import type { Place } from "@/lib/now";
import { timeAgo } from "@/lib/time";
import { tag } from "@/components/ui/sticker";
import { Prompt, Tile } from "../Tile";

function CountryStamp({ count }: { count: number }) {
  return (
    <p className="grid size-24 shrink-0 -rotate-[10deg] place-items-center rounded-full border-[3px] border-dashed border-night text-center text-[13px] leading-tight font-bold">
      <span>
        <span className="font-mono text-3xl leading-none">{count}</span>
        <br />
        {count === 1 ? "country" : "countries"}
      </span>
    </p>
  );
}

// Server-only by design: a private place still carries its city, and only formatLocation's output may reach HTML.
export function LocationTile({ place, countriesVisited }: { place: Place | null; countriesVisited: number }) {
  return (
    <Tile tilt="left" core="flex flex-col justify-between gap-5 bg-tea p-6 text-night">
      <div>
        <Prompt>whereami</Prompt>
        <span className={`${tag} mt-1.5 bg-surface text-ink`}>{place ? "Right now" : "So far"}</span>
      </div>
      {place ? (
        <>
          <div>
            <p className="text-3xl leading-none font-bold tracking-tight">{formatLocation(place)}</p>
            <p className="mt-2 text-sm font-medium">updated {timeAgo(place.updatedAt)}</p>
          </div>
          {countriesVisited > 0 && (
            <div className="flex justify-end">
              <CountryStamp count={countriesVisited} />
            </div>
          )}
        </>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <p className="text-2xl leading-tight font-bold">countries and counting</p>
          <CountryStamp count={countriesVisited} />
        </div>
      )}
    </Tile>
  );
}
