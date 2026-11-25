import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Coffee } from "@phosphor-icons/react/dist/ssr";
import { Prompt, Tile } from "@/components/board/Tile";
import { Chips } from "@/components/sections/Section";
import { buttonBubble, focusRing, focusRingOnColor, stickerButtonShape } from "@/components/ui/sticker";
import { JsonLd } from "@/components/JsonLd";
import { achievements, coffeeChat, contact } from "@/content/site";
import { projectSlug, projectsJsonLd } from "@/lib/jsonld";

const title = "Mason Bair's projects and hackathon wins";
const description =
  "Apps, games and hackathon projects by Mason Bair: Where Are My Friends, Unfaded, NexHacks 1st and 2nd place, Hack Dearborn 4 1st place overall, and more.";

export const metadata: Metadata = {
  title: { absolute: `Projects | Mason Bair` },
  description,
  alternates: { canonical: "/projects" },
  openGraph: { type: "website", siteName: "Mason Bair", title, description, url: "/projects" },
};

const fills = ["bg-surface", "bg-surface", "bg-tea", "bg-surface", "bg-surface", "bg-accent", "bg-surface", "bg-surface"];
const onColor = (fill: string) => fill !== "bg-surface";

export default function ProjectsPage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] overflow-x-clip px-4 pt-24 pb-24 md:px-8">
      <JsonLd data={projectsJsonLd()} />

      <Tile core="bg-tea p-7 text-night md:p-12">
        <Prompt>ls ~/projects</Prompt>
        <h1 className="mt-2 max-w-[18ch] text-5xl leading-[0.95] font-bold tracking-[-0.04em] md:text-7xl">{title}</h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed md:text-xl">
          Things I have built at hackathons, in school and on my own time. Some won prizes, some are still in progress. Want to hear
          the story behind one?
        </p>
        <a
          href={coffeeChat.href}
          data-burst
          className={`${stickerButtonShape} ${focusRingOnColor} mt-8 border-night bg-night text-snow`}
        >
          {coffeeChat.label}
          <span className={buttonBubble}>
            <Coffee weight="light" size={18} aria-hidden />
          </span>
        </a>
      </Tile>

      <div className="mt-10 gap-5 md:mt-14 md:columns-2">
        {achievements.map((a, i) => {
          const fill = fills[i % fills.length];
          const colored = onColor(fill);
          return (
            <article key={a.title} id={projectSlug(a.title)} className="mb-5 scroll-mt-28 break-inside-avoid pt-1">
              <Tile tilt={colored ? (i % 2 ? "left" : "right") : "none"} core={`flex flex-col ${fill}`}>
                {a.image && (
                  <div className="relative aspect-[4/3]">
                    <Image
                      src={a.image.src}
                      alt={a.image.alt}
                      fill
                      sizes="(min-width: 1400px) 680px, (min-width: 768px) 48vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col justify-between gap-5 p-6 md:p-7">
                  <div>
                    <h2 className={`text-2xl leading-tight font-semibold tracking-tight md:text-3xl ${colored ? "text-night" : "text-ink"}`}>
                      {a.href ? (
                        <a
                          href={a.href}
                          className={`underline decoration-2 underline-offset-4 ${colored ? focusRingOnColor : focusRing}`}
                        >
                          {a.title} <ArrowUpRight weight="bold" size={18} className="inline" aria-hidden />
                        </a>
                      ) : (
                        a.title
                      )}
                    </h2>
                    <p className={`mt-3 max-w-[60ch] leading-relaxed ${colored ? "text-night" : "text-mute"}`}>{a.summary}</p>
                  </div>
                  <Chips
                    items={a.tech}
                    className={colored ? "border-night bg-transparent text-night" : "border-line bg-surface text-ink"}
                  />
                </div>
              </Tile>
            </article>
          );
        })}
      </div>

      <p className="mt-16 max-w-[60ch] text-lg leading-relaxed text-mute">
        More code lives on{" "}
        <a href={contact.github} className={`font-bold text-ink underline underline-offset-4 ${focusRing}`}>
          GitHub
        </a>
        , and my work history is on the{" "}
        <Link href="/#projects" className={`font-bold text-ink underline underline-offset-4 ${focusRing}`}>
          home page
        </Link>
        .
      </p>
    </main>
  );
}
