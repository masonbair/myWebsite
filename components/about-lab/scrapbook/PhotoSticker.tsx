import type { ScrapPhoto } from "./photos";
import { ScrapImage } from "./ScrapImage";

const tilts = { left: "md:-rotate-[1.5deg]", right: "md:rotate-[2deg]" };

/** An album photo pasted in like a print: a white border, a tilt and a short caption under it. */
export function PhotoSticker({
  photo,
  tilt,
  sizes,
  preload = false,
  aspect = "aspect-[4/5]",
}: {
  photo: ScrapPhoto;
  tilt: keyof typeof tilts;
  sizes: string;
  preload?: boolean;
  aspect?: string;
}) {
  return (
    <figure className={`rounded-2xl border-[2.5px] border-line bg-surface p-2.5 pb-3 shadow-sticker-sm ${tilts[tilt]}`}>
      <div className={`relative overflow-hidden rounded-xl border-2 border-line bg-ink/5 ${aspect}`}>
        <ScrapImage
          remote={photo.remote}
          src={photo.src}
          alt={photo.alt}
          fill
          preload={preload}
          sizes={sizes}
          className="object-cover"
        />
      </div>
      {photo.caption && (
        <figcaption className="mt-2.5 px-1 text-sm font-semibold tracking-tight text-mute">{photo.caption}</figcaption>
      )}
    </figure>
  );
}
