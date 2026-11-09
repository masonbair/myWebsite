import Image from "next/image";
import { work } from "@/content/site";
import { Chips, Section } from "./Section";

export function Work() {
  return (
    <Section id="projects" title="Work and experience">
      <ol className="mt-10 md:mt-14">
        {work.map((w, i) => (
          <li key={`${w.title}-${w.org}`} className="grid grid-cols-[4rem_1fr] gap-x-5 md:grid-cols-[5rem_1fr] md:gap-x-8 lg:grid-cols-[12.5rem_5rem_1fr]">
            <p className="hidden pt-2 text-right text-sm font-medium whitespace-nowrap text-mute lg:block">{w.dates}</p>
            <div className="flex flex-col items-center">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border-[2.5px] border-line bg-ink/5 shadow-sticker-sm md:size-20">
                <Image src={w.image.src} alt={w.image.alt} fill sizes="80px" className="object-cover" />
              </div>
              {i < work.length - 1 && <span aria-hidden className="my-3 w-0 flex-1 border-l-2 border-dashed border-line/40" />}
            </div>
            <div className="pb-12 md:pb-14 lg:pt-1">
              <p className="text-sm font-medium text-mute lg:hidden">{w.dates}</p>
              <h3 className="mt-1 text-xl leading-tight font-semibold tracking-tight text-ink md:text-2xl lg:mt-0">{w.title}</h3>
              <p className="mt-1 font-semibold text-accent-ink">{w.org}</p>
              <p className="mt-3 max-w-[62ch] leading-relaxed text-mute">{w.summary}</p>
              <div className="mt-4">
                <Chips items={w.tech} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
