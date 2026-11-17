import { CollectorImage } from "@/components/ui/CollectorImage";
import { about } from "@/content/site";
import { loadPlacedPhotos } from "@/lib/photos/placed";
import { Tile } from "../board/Tile";
import { Section } from "./Section";

export async function About() {
  const [lead, ...rest] = about;
  const { about: portrait } = await loadPlacedPhotos();
  return (
    <Section id="about" title="About me">
      <div className="mt-10 grid gap-10 md:mt-14 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className={portrait ? "lg:col-span-7" : "lg:col-span-12"}>
          <p className="max-w-[60ch] text-xl leading-relaxed text-ink md:text-2xl md:leading-snug">{lead}</p>
          {rest.map((p) => (
            <p key={p} className="mt-5 max-w-[65ch] text-base leading-relaxed text-mute md:text-lg">
              {p}
            </p>
          ))}
        </div>
        {portrait && (
          <div className="w-full max-w-sm lg:col-span-5 lg:max-w-none">
            <Tile tilt="right" core="aspect-[3/4] bg-ink/5">
              <CollectorImage
                src={portrait.src}
                alt={portrait.alt}
                fill
                sizes="(min-width: 1400px) 500px, (min-width: 1024px) 36vw, 384px"
                className="object-cover"
              />
            </Tile>
          </div>
        )}
      </div>
    </Section>
  );
}
