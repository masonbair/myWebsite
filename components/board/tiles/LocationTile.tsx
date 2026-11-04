import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { formatLocation } from "@/lib/location";
import type { Place } from "@/lib/now";
import { timeAgo } from "@/lib/time";
import { Tile } from "../Tile";

// Server-only by design: a private place still carries its city, and only formatLocation's output may reach HTML.
export function LocationTile({ place, countriesVisited }: { place: Place | null; countriesVisited: number }) {
  return (
    <Tile core="flex flex-col justify-between gap-6 bg-accent p-6 md:p-7">
      <MapPin weight="light" size={28} className="text-snow" aria-hidden />
      {place ? (
        <div>
          <p className="text-sm font-semibold text-night">Currently in</p>
          <p className="mt-1 text-3xl leading-tight font-bold tracking-tight text-snow">{formatLocation(place)}</p>
          <p className="mt-3 flex flex-col text-sm font-medium text-night">
            {countriesVisited > 0 && (
              <span>
                Country no. <span className="font-mono">{countriesVisited}</span>
              </span>
            )}
            <span>updated {timeAgo(place.updatedAt)}</span>
          </p>
        </div>
      ) : (
        <p className="flex flex-col">
          <span className="font-mono text-7xl leading-none font-medium tracking-tighter text-snow">{countriesVisited}</span>
          <span className="mt-2 text-lg font-semibold text-night">countries and counting</span>
        </p>
      )}
    </Tile>
  );
}
