import type { Board as BoardData } from "@/lib/board";
import type { Photo } from "@/lib/now";
import { Reveal } from "./Reveal";
import { BakeTile } from "./tiles/BakeTile";
import { GithubTile } from "./tiles/GithubTile";
import { HelloTile } from "./tiles/HelloTile";
import { LocationTile } from "./tiles/LocationTile";
import { PhotoTile } from "./tiles/PhotoTile";
import { ProjectsTile } from "./tiles/ProjectsTile";

const FALLBACK_PHOTO: Photo = {
  src: "/misc/Mason_traveling.webp",
  alt: "Mason smiling in a red bucket hat and sunglasses, taking a selfie on a roadside with green mountains behind him",
};

const TALL = "md:col-span-3 md:row-span-2 lg:col-span-3 lg:row-span-2";

// These fill the first screen, so they paint at once: a fade-in there blanks Lighthouse's filmstrip and raises Speed Index.
const FIRST_SCREEN = new Set(["hello", "location", "photo", "github"]);

// Spans are picked from which tiles exist so every grid row is filled; dense flow alone leaves holes.
export function Board({ board }: { board: BoardData }) {
  const { now, github } = board;
  const hasLocation = now.place !== null || now.countriesVisited > 0;
  const online = (github?.online ?? []).flatMap((r) => (r.homepage ? [{ ...r, homepage: r.homepage }] : []));
  const photos = now.photos.length > 0 ? now.photos : [FALLBACK_PHOTO];
  const lowerSpan = online.length > 0 && now.bake ? null : "md:col-span-6 lg:col-span-12";

  const tiles = [
    { key: "hello", span: "md:col-span-6 md:row-span-2 lg:col-span-6", node: <HelloTile /> },
    hasLocation && {
      key: "location",
      span: "md:col-span-3 lg:col-span-3",
      node: <LocationTile place={now.place} countriesVisited={now.countriesVisited} />,
    },
    {
      key: "photo",
      span: hasLocation ? "md:col-span-6 lg:col-span-3 lg:row-span-2" : TALL,
      node: <PhotoTile photos={photos.map(({ src, alt }) => ({ src, alt }))} />,
    },
    { key: "github", span: hasLocation ? "md:col-span-3 lg:col-span-3" : TALL, node: <GithubTile github={github} /> },
    online.length > 0 && {
      key: "projects",
      span: lowerSpan ?? "md:col-span-3 lg:col-span-8",
      node: <ProjectsTile repos={online} />,
    },
    now.bake && { key: "bake", span: lowerSpan ?? "md:col-span-3 lg:col-span-4", node: <BakeTile bake={now.bake} /> },
  ].filter((t) => !!t);

  return (
    <section aria-label="Right now" className="mx-auto w-full max-w-[1400px] px-4 md:px-8">
      <div
        data-board-grid
        className="grid grid-flow-row-dense grid-cols-1 gap-4 md:gap-5 md:grid-cols-6 lg:grid-cols-12 lg:grid-rows-[repeat(2,minmax(17.5rem,auto))]"
      >
        {tiles.map((t, i) =>
          FIRST_SCREEN.has(t.key) ? (
            <div key={t.key} className={t.span}>
              {t.node}
            </div>
          ) : (
            <Reveal key={t.key} index={i} className={t.span}>
              {t.node}
            </Reveal>
          ),
        )}
      </div>
    </section>
  );
}
