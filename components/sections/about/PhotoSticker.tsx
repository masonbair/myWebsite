import { CollectorImage } from "@/components/ui/CollectorImage";
import type { CollectorPhoto } from "@/lib/collector-photos";

/** A small tilted photo sticker beside an answer. */
export function PhotoSticker({ photo }: { photo: CollectorPhoto }) {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border-[2.5px] border-line bg-ink/5 shadow-tile md:w-60 md:rotate-[2deg]">
      <CollectorImage src={photo.src} alt={photo.alt} fill sizes="(min-width: 768px) 240px, 60vw" className="object-cover" />
    </div>
  );
}
