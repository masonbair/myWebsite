import {
  ArrowUpRight,
  Campfire,
  Cookie,
  GraduationCap,
  HardDrives,
  Laptop,
  Medal,
  MicrophoneStage,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Prompt, Tile } from "@/components/board/Tile";
import { buttonBubble, stickerButton, tag } from "@/components/ui/sticker";
import { coffeeChat } from "@/content/site";
import { formatLocation } from "@/lib/location";
import type { Place } from "@/lib/now";
import { countries, facts, hello, type FactSticker } from "./copy";
import { fills, softText } from "./fills";
import { FlipSticker } from "./FlipSticker";
import { PhotoSticker } from "./PhotoSticker";
import type { ScrapPhoto } from "./photos";

const PHOTO_SIZES = "(min-width: 1280px) 320px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 75vw";

const icons: Record<string, Icon> = {
  fullsend: Laptop,
  hacksu: UsersThree,
  estonia: GraduationCap,
  honey: Cookie,
  hostel: MicrophoneStage,
  "school-jobs": HardDrives,
  award: Medal,
  eagle: Campfire,
};

function Front({ fact }: { fact: FactSticker }) {
  const Glyph = icons[fact.id];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-semibold ${softText(fact.fill)}`}>{fact.kicker}</p>
        {Glyph && <Glyph weight="light" size={28} aria-hidden className="shrink-0" />}
      </div>
      <h2 className="mt-1.5 text-2xl leading-tight font-bold tracking-tight">{fact.title}</h2>
    </div>
  );
}

function Fact({ fact }: { fact: FactSticker }) {
  const front = <Front fact={fact} />;
  if (!fact.story) {
    return (
      <article className={`rounded-2xl border-[2.5px] border-line p-5 shadow-sticker-sm md:p-6 ${fills[fact.fill]}`}>{front}</article>
    );
  }
  return (
    <FlipSticker
      fill={fact.fill}
      title={fact.title}
      front={front}
      back={
        <div>
          <p className={`text-sm font-semibold ${softText(fact.fill)}`}>{fact.title}</p>
          <p className="mt-2 text-base leading-relaxed">{fact.story}</p>
        </div>
      }
    />
  );
}

function CountriesSticker({ count, place }: { count: number; place: Place | null }) {
  const title = `${count} countries so far`;
  return (
    <FlipSticker
      fill="tea"
      title={title}
      front={
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-night/80">{place ? `Right now: ${formatLocation(place)}` : countries.kicker}</p>
              <h2 className="mt-1.5 text-2xl leading-tight font-bold tracking-tight">{title}</h2>
            </div>
            <p aria-hidden className="grid size-20 shrink-0 -rotate-[10deg] place-items-center rounded-full border-[3px] border-dashed border-night text-center text-xs leading-tight font-bold">
              <span>
                <span className="font-mono text-2xl leading-none">{count}</span>
                <br />
                countries
              </span>
            </p>
          </div>
          <p className="mt-4 text-sm font-semibold text-night/80">{countries.favoritesLabel}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {countries.favorites.map((c) => (
              <li key={c} className={`${tag} border-night bg-snow text-xs text-night`}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      }
      back={
        <div>
          <p className="text-sm font-semibold text-night/80">{title}</p>
          <p className="mt-2 text-base leading-relaxed">{countries.story}</p>
        </div>
      }
    />
  );
}

/** Stickers first, with a photo after every second one so prints are spread through every column. */
function interleave(stickers: ReactNode[], photos: ScrapPhoto[]): ReactNode[] {
  const out: ReactNode[] = [];
  let p = 0;
  stickers.forEach((sticker, i) => {
    out.push(sticker);
    if (i % 2 === 0 && p < photos.length) {
      out.push(
        // Phones show prints narrower and alternately left and right, so the single column reads as pasted in.
        <div key={photos[p].src} className={`w-3/4 sm:w-auto ${p % 2 ? "" : "ml-auto sm:ml-0"}`}>
          <PhotoSticker photo={photos[p]} tilt={p % 2 ? "left" : "right"} sizes={PHOTO_SIZES} />
        </div>,
      );
      p++;
    }
  });
  return out;
}

/** The About page as a scrapbook: a short hello, then fact stickers that flip for the story, mixed with album photos. */
export function Scrapbook({ photos, countriesVisited, place }: { photos: ScrapPhoto[]; countriesVisited: number; place: Place | null }) {
  const [lead, ...rest] = photos;
  const stickers = [
    countriesVisited > 0 && <CountriesSticker key="countries" count={countriesVisited} place={place} />,
    ...facts.map((f) => <Fact key={f.id} fact={f} />),
  ].filter(Boolean);

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-12 lg:items-center">
        <div className={lead ? "lg:col-span-8" : "lg:col-span-12"}>
          <Tile core="flex flex-col bg-surface p-6 md:p-9">
            <Prompt className="text-accent-ink">{hello.prompt}</Prompt>
            <span className={`${tag} mt-2 self-start border-line bg-tea text-[11px] text-night`}>{hello.tag}</span>
            <h1 className="mt-5 text-5xl leading-[0.98] font-bold tracking-[-0.04em] text-ink md:text-7xl">{hello.heading}</h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-mute md:text-xl">{hello.body}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href={coffeeChat.href} className={stickerButton}>
                {coffeeChat.label}
                <span className={buttonBubble}>
                  <ArrowUpRight weight="bold" size={16} aria-hidden />
                </span>
              </a>
              <span className="font-semibold text-mute">{hello.hint}</span>
            </div>
          </Tile>
        </div>
        {lead && (
          <div className="mx-auto w-full max-w-sm lg:col-span-4 lg:max-w-none lg:px-6">
            <PhotoSticker photo={lead} tilt="right" preload sizes="(min-width: 1400px) 400px, (min-width: 1024px) 28vw, 384px" />
          </div>
        )}
      </div>

      <div className="mt-10 gap-5 sm:columns-2 md:mt-14 lg:columns-3 xl:columns-4 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {interleave(stickers, rest)}
      </div>
    </>
  );
}
