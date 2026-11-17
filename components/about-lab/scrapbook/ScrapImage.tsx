"use client";

import Image, { type ImageProps } from "next/image";
import { CollectorImage } from "@/components/ui/CollectorImage";
import { snapPhotoWidth } from "@/lib/collector-photos";

const liveLoader = ({ src, width }: { src: string; width: number }) =>
  `https://masonbair.com${src}?w=${snapPhotoWidth(width)}`;

/** A phone photo; `remote` (lab fixture only) loads it from the live site because local runs have no photo database. */
export function ScrapImage({ remote, alt, ...props }: Omit<ImageProps, "loader"> & { remote?: boolean }) {
  return remote ? <Image {...props} alt={alt} loader={liveLoader} /> : <CollectorImage {...props} alt={alt} />;
}
