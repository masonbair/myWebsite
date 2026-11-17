"use client";

import Image, { type ImageProps } from "next/image";
import { collectorPhotoLoader } from "@/lib/collector-photos";

/** next/image for a phone photo; a client component because server components cannot pass the loader function. */
export function CollectorImage({ alt, ...props }: Omit<ImageProps, "loader">) {
  return <Image {...props} alt={alt} loader={collectorPhotoLoader} />;
}
