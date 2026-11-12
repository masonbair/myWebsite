import { lowerKeys, lowerSpans, type Board as BoardData } from "@/lib/board";
import { movers, risingTopics } from "@/lib/news/movers";
import type { Photo } from "@/lib/now";
import { LazyBoardMotion } from "./motion/LazyBoardMotion";
import { Reveal } from "./Reveal";
import { BakeTile } from "./tiles/BakeTile";
import { GithubTile } from "./tiles/GithubTile";
import { HelloTile } from "./tiles/HelloTile";
import { LocationTile } from "./tiles/LocationTile";
import { NewsTile } from "./tiles/NewsTile";
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
  const { now, github, trends } = board;
  const hasLocation = now.place !== null || now.countriesVisited > 0;
  const online = (github?.online ?? []).flatMap((r) => (r.homepage ? [{ ...r, homepage: r.homepage }] : []));
  const photos = now.photos.length > 0 ? now.photos : [FALLBACK_PHOTO];
  const rising = trends ? risingTopics(movers(trends.rows, trends.today), 3) : [];
  const shown = lowerKeys(hasLocation ? 4 : 3, { projects: online.length > 0, news: rising.length >= 3, bake: !!now.bake });
  const lower = lowerSpans(shown);

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
    shown.includes("projects") && {
      key: "projects",
      span: lower.get("projects"),
      node: <ProjectsTile repos={online} />,
    },
    shown.includes("news") && { key: "news", span: lower.get("news"), node: <NewsTile rising={rising} /> },
    shown.includes("bake") && now.bake && { key: "bake", span: lower.get("bake"), node: <BakeTile bake={now.bake} /> },
  ].filter((t) => !!t);

  return (
    // Clipped sideways so a tile mid-swing (rotated) never widens the page on a phone.
    <section aria-label="Right now" className="mx-auto w-full max-w-[1400px] overflow-x-clip px-4 md:px-8">
      <div
        data-board-grid
        className="grid grid-flow-row-dense grid-cols-1 gap-4 md:gap-5 md:grid-cols-6 lg:grid-cols-12 lg:grid-rows-[repeat(2,minmax(17.5rem,auto))]"
      >
        {tiles.map((t, i) =>
          FIRST_SCREEN.has(t.key) ? (
            <div key={t.key} data-tile={t.key} className={t.span}>
              {t.node}
            </div>
          ) : (
            <Reveal key={t.key} tile={t.key} index={i} className={t.span}>
              {t.node}
            </Reveal>
          ),
        )}
      </div>
      {/* Reserved height for the Draw buttons, which arrive after first paint. */}
      <div className="mt-4 h-11">
        <LazyBoardMotion sunOffsetMinutes={board.sunOffsetMinutes} />
      </div>
    </section>
  );
}
