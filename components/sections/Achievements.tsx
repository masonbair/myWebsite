import Image from "next/image";
import { achievements, gallery, type Achievement } from "@/content/site";
import { focusRing } from "@/components/ui/sticker";
import { Tile } from "../board/Tile";
import { Chips, Section } from "./Section";

type Cell = { span: string; tone: "surface" | "accent" | "tea"; sizes: string; tilt?: "left" | "right" };

// One entry per achievement, in order; spans fill the 6 and 12 column grids with no holes.
const cells: Cell[] = [
  { span: "md:col-span-6 lg:col-span-12", tone: "surface", sizes: "" },
  {
    span: "md:col-span-6 lg:col-span-7 lg:row-span-2",
    tone: "surface",
    sizes: "(min-width: 1400px) 760px, (min-width: 1024px) 56vw, (min-width: 768px) 92vw, 100vw",
  },
  { span: "md:col-span-3 lg:col-span-5", tone: "surface", sizes: "" },
  { span: "md:col-span-3 lg:col-span-5", tone: "accent", sizes: "", tilt: "right" },
  {
    span: "md:col-span-6 lg:col-span-5 lg:row-span-2",
    tone: "surface",
    sizes: "(min-width: 1400px) 540px, (min-width: 1024px) 40vw, (min-width: 768px) 92vw, 100vw",
  },
  { span: "md:col-span-3 lg:col-span-7", tone: "surface", sizes: "" },
  { span: "md:col-span-3 lg:col-span-7", tone: "tea", sizes: "", tilt: "left" },
];

const tones = {
  surface: { core: "bg-surface", title: "text-ink", body: "text-mute", chip: "border-line bg-surface text-ink" },
  accent: { core: "bg-accent", title: "text-night", body: "text-night", chip: "border-night bg-transparent text-night" },
  tea: { core: "bg-tea", title: "text-night", body: "text-night", chip: "border-night bg-transparent text-night" },
};

const STRIP_HEIGHT = { base: 256, md: 320 };

function AchievementCell({ a, cell }: { a: Achievement; cell: Cell }) {
  const tone = tones[cell.tone];
  return (
    <div className={cell.span}>
      <Tile tilt={cell.tilt} core={`flex flex-col ${tone.core}`}>
        {a.image && (
          <div className="relative aspect-[4/3] md:aspect-[16/9] lg:aspect-auto lg:min-h-64 lg:flex-1">
            <Image src={a.image.src} alt={a.image.alt} fill sizes={cell.sizes} className="object-cover" />
          </div>
        )}
        <div className="flex flex-1 flex-col justify-between gap-5 p-6 md:p-7 lg:flex-none">
          <div>
            <h3 className={`text-xl leading-tight font-semibold tracking-tight md:text-2xl ${tone.title}`}>
              {a.href ? (
                <a href={a.href} className={`underline decoration-2 underline-offset-4 ${focusRing}`}>
                  {a.title} <span aria-hidden>↗</span>
                </a>
              ) : (
                a.title
              )}
            </h3>
            <p className={`mt-2 max-w-[60ch] leading-relaxed ${tone.body}`}>{a.summary}</p>
          </div>
          <Chips items={a.tech} className={tone.chip} />
        </div>
      </Tile>
    </div>
  );
}

export function Achievements() {
  return (
    <Section id="achievements" title="Hackathons and side projects" prompt="cat wins.txt">
      <div className="mt-10 grid grid-cols-1 gap-5 md:mt-14 md:grid-cols-6 lg:grid-cols-12">
        {achievements.map((a, i) => (
          <AchievementCell key={a.title} a={a} cell={cells[i]} />
        ))}
      </div>

      <h3 className="mt-20 text-2xl font-semibold tracking-tight text-ink md:mt-24">Photos from events and clubs</h3>
      <div
        role="region"
        aria-label="Event and club photos"
        tabIndex={0}
        className="-mx-4 mt-6 snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-6 outline-none [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent-ink md:-mx-8 md:scroll-px-8 md:px-8"
      >
        <ul className="flex w-max gap-3">
          {gallery.map((g) => {
            const ratio = g.width / g.height;
            return (
              <li key={g.src} className="snap-start">
                <Image
                  src={g.src}
                  alt={g.alt}
                  width={g.width}
                  height={g.height}
                  sizes={`(min-width: 768px) ${Math.round(STRIP_HEIGHT.md * ratio)}px, ${Math.round(STRIP_HEIGHT.base * ratio)}px`}
                  className="h-64 w-auto rounded-tile border-[2.5px] border-line bg-ink/5 object-cover shadow-sticker-sm md:h-80"
                />
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
