import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { Chips, Section } from "@/components/sections/Section";
import { CollectorImage } from "@/components/ui/CollectorImage";
import { buttonBubble, focusRing, stickerButton, tag } from "@/components/ui/sticker";
import { Tile } from "@/components/board/Tile";
import { coffeeChat } from "@/content/site";
import { chapters, intro, outro, type Chapter } from "./copy";
import { loadChapterPhotos, type ChapterPhotos } from "./photos";
import { ChapterSticker } from "./stickers";
import styles from "./chapters.module.css";

const row = "grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-5 md:gap-x-8 lg:grid-cols-[4rem_minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-12";
const marker =
  "relative z-10 grid size-11 shrink-0 place-items-center rounded-full border-2 border-line bg-surface font-mono text-sm font-bold text-ink lg:size-16 lg:text-xl";
const portraitSizes = "(min-width: 1024px) 448px, calc(100vw - 96px)";
const wideSizes = "(min-width: 1400px) 640px, (min-width: 1024px) 48vw, calc(100vw - 96px)";

function Spine() {
  return (
    <span aria-hidden className="relative mt-3 w-0 flex-1 border-l-2 border-dashed border-line/35">
      <span className={`absolute inset-y-0 -left-[2px] w-[2px] bg-accent-ink ${styles.fill}`} />
    </span>
  );
}

function ChapterMedia({ chapter, photos, tilt }: { chapter: Chapter; photos: ChapterPhotos; tilt: "left" | "right" }) {
  const { media } = chapter;
  if ("image" in media) {
    return (
      <div className="max-w-md">
        <Tile tilt={tilt} core="aspect-[4/5] bg-ink/5">
          <Image src={media.image.src} alt={media.image.alt} fill sizes={portraitSizes} className="object-cover" />
        </Tile>
      </div>
    );
  }
  const pin = "pin" in media ? media.pin : undefined;
  const photo = pin && photos[pin];
  if (!photo) return <ChapterSticker kind={media.sticker} tilt={tilt} />;
  const wide = pin === "fullsend";
  return (
    <div className={wide ? "" : "max-w-md"}>
      <Tile tilt={tilt} core={`bg-ink/5 ${wide ? "aspect-[4/3]" : "aspect-[4/5]"}`}>
        <CollectorImage src={photo.src} alt={photo.alt} fill sizes={wide ? wideSizes : portraitSizes} className="object-cover" />
      </Tile>
    </div>
  );
}

/** Mason's story as five short chapters on a dashed spine that fills in as you scroll. */
export async function Chapters() {
  const photos = await loadChapterPhotos();
  return (
    <Section id="about" title="About me" prompt="cat story.txt">
      <div className="mt-6 grid gap-8 md:mt-8 lg:grid-cols-12 lg:items-end lg:gap-12">
        <p className="max-w-[44ch] text-xl leading-snug text-ink md:text-2xl lg:col-span-7">{intro}</p>
        <nav aria-label="Chapters" className="lg:col-span-5">
          <ol className="flex flex-wrap gap-2">
            {chapters.map((c, i) => (
              <li key={c.id}>
                <a href={`#${c.id}`} className={`${tag} border-line bg-surface text-sm text-ink ${focusRing}`}>
                  <span className="font-mono text-accent-ink">{i + 1}</span> {c.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <ol className="mt-16 md:mt-24">
        {chapters.map((c, i) => (
          <li key={c.id} id={c.id} aria-labelledby={`${c.id}-title`} className={`${row} scroll-mt-28`}>
            <div className="flex flex-col items-center">
              <span aria-hidden className={`${marker} ${styles.marker}`}>
                {i + 1}
              </span>
              <Spine />
            </div>
            <div className="pb-20 md:pb-28 lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:items-start">
              <div className="pt-2 lg:pt-4">
                <p className="font-mono text-xs font-medium text-accent-ink">
                  <span className="sr-only">Chapter {i + 1}: </span>
                  {c.label} · {c.when}
                </p>
                <h3
                  id={`${c.id}-title`}
                  className="mt-3 max-w-[16ch] text-3xl leading-[1.02] font-bold tracking-[-0.04em] text-balance text-ink md:text-5xl"
                >
                  {c.title}
                </h3>
                <div className="mt-5 max-w-[46ch] space-y-3 text-lg leading-relaxed text-pretty text-mute">
                  {c.body.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </div>
                {c.tags && (
                  <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="text-sm font-semibold text-mute">{c.tags.heading}</p>
                    <Chips items={c.tags.items} />
                  </div>
                )}
              </div>
              <div className={`mt-10 lg:mt-0 ${styles.media}`}>
                <ChapterMedia chapter={c} photos={photos} tilt={i % 2 === 0 ? "right" : "left"} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className={row}>
        <div className="flex justify-center">
          <span aria-hidden className="relative z-10 mt-3 size-5 rounded-full border-2 border-line bg-tea lg:mt-5" />
        </div>
        <div className="lg:col-span-2">
          <h3 className="max-w-[18ch] text-3xl leading-[1.02] font-bold tracking-[-0.04em] text-balance text-ink md:text-5xl">
            {outro.title}
          </h3>
          <p className="mt-4 max-w-[46ch] text-lg leading-relaxed text-mute">{outro.body}</p>
          <a href={coffeeChat.href} className={`${stickerButton} mt-8`}>
            {coffeeChat.label}
            <span className={buttonBubble}>
              <ArrowUpRight weight="bold" size={16} aria-hidden />
            </span>
          </a>
        </div>
      </div>
    </Section>
  );
}
