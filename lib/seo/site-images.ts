import { achievements, gallery, siteUrl, work, type SiteImage } from "@/content/site";

export const PROFILE_PHOTO = { src: "/misc/mason-bair.webp", alt: "Mason Bair" };

/** Every fixed photo of Mason on the home page, profile photo first, as absolute URLs; feeds the image sitemap and search data. */
export function sitePhotos(): { url: string; alt: string }[] {
  const all: Pick<SiteImage, "src" | "alt">[] = [
    PROFILE_PHOTO,
    ...work.map((w) => w.image),
    ...achievements.flatMap((a) => (a.image ? [a.image] : [])),
    ...gallery,
  ];
  const seen = new Set<string>();
  return all
    .filter((img) => img.src.startsWith("/misc/") && !seen.has(img.src) && seen.add(img.src))
    .map((img) => ({ url: `${siteUrl}${img.src}`, alt: img.alt }));
}
