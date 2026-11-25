import { ArrowUpRight, FilmSlate, Heart } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { tag } from "@/components/ui/sticker";
import { LETTERBOXD_PROFILE, LETTERBOXD_USER, stars, type Film } from "@/lib/letterboxd";
import { timeAgo } from "@/lib/time";
import { Prompt, Tile } from "../Tile";

const focusRing = "outline-none focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-night";

// Watched dates are calendar days, so noon UTC keeps "2 days ago" from flipping with the reader's zone.
const watched = (film: Film) => timeAgo(`${film.watchedOn}T12:00:00Z`).replace("just now", "today");

function Rating({ film, className = "" }: { film: Film; className?: string }) {
  if (film.rating === null && !film.liked) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {film.rating !== null && (
        <span role="img" aria-label={`${film.rating} out of 5 stars`} className="text-lg leading-none tracking-[0.08em]">
          {stars(film.rating)}
        </span>
      )}
      {film.liked && <Heart weight="fill" size={14} aria-label="Liked" />}
    </span>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <Prompt className="text-night/70">letterboxd --recent</Prompt>
        <FilmSlate weight="light" size={28} className="mt-2 text-night" aria-hidden />
      </div>
      <a
        href={LETTERBOXD_PROFILE}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${LETTERBOXD_USER} on Letterboxd`}
        className={`${tag} inline-flex items-center gap-1 border-night bg-tea text-[11px] text-night ${focusRing}`}
      >
        Letterboxd
        <ArrowUpRight weight="bold" size={10} aria-hidden />
      </a>
    </div>
  );
}

function Poster({ film }: { film: Film }) {
  return (
    <div className="relative aspect-[2/3] w-2/5 shrink-0 self-center overflow-hidden rounded-lg border-2 border-night bg-night/10">
      {film.poster && <Image src={film.poster} alt="" fill sizes="(min-width: 1024px) 15vw, 40vw" className="object-cover" />}
    </div>
  );
}

/** Mason's latest film from Letterboxd: its poster beside the title, rating and the start of his review. */
export function FilmsTile({ films }: { films: Film[] }) {
  const [latest, ...earlier] = films;
  return (
    <Tile tilt="right" core="flex items-stretch gap-5 bg-tea p-6 md:p-7">
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-5">
        <Header />
        <div>
          <p className="text-sm font-semibold text-night/80">Last watched · {watched(latest)}</p>
          <a
            href={latest.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-1 block rounded text-2xl leading-tight font-bold tracking-tight text-night hover:underline ${focusRing}`}
          >
            {latest.title}
            {latest.year && <span className="font-medium text-night/70"> ({latest.year})</span>}
          </a>
          <Rating film={latest} className="mt-2 font-mono text-sm text-night" />
          {latest.review && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-night/85">“{latest.review}”</p>}
          {earlier.length > 0 && (
            <p className="mt-3 text-xs text-night/70">
              Before that: {earlier.slice(0, 2).map((f) => f.title).join(", ")}
            </p>
          )}
        </div>
      </div>
      <Poster film={latest} />
    </Tile>
  );
}
