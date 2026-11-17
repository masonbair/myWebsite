"use client";

import Image from "next/image";
import { CollectorImage } from "@/components/ui/CollectorImage";
import { collectorPhotoLoader } from "@/lib/collector-photos";
import type { AnswerPhoto } from "./photos";

const SIZES = "(min-width: 768px) 240px, 60vw";

// Lab only: with no local database, fixture photos load from the live site's photo route.
const liveSiteLoader = ({ src, width }: { src: string; width: number }) =>
  `https://masonbair.com${collectorPhotoLoader({ src, width })}`;

/** A small tilted photo sticker beside an answer. */
export function PhotoSticker({ photo }: { photo: AnswerPhoto }) {
  const props = { src: photo.src, alt: photo.alt, fill: true, sizes: SIZES, className: "object-cover" };
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border-[2.5px] border-line bg-ink/5 shadow-tile md:w-60 md:rotate-[2deg]">
      {photo.remote ? <Image {...props} alt={photo.alt} loader={liveSiteLoader} /> : <CollectorImage {...props} />}
    </div>
  );
}
