import type { Metadata } from "next";
import { loadScrapPhotos } from "@/components/about-lab/scrapbook/photos";
import { Scrapbook } from "@/components/about-lab/scrapbook/Scrapbook";
import { loadNow } from "@/lib/now";

// A design preview for Mason to compare, so search engines must never list it.
export const metadata: Metadata = {
  title: "About, scrapbook preview",
  robots: { index: false, follow: false },
};

export const revalidate = 3600;

export default async function AboutScrapbookLab() {
  const [photos, now] = await Promise.all([loadScrapPhotos(), loadNow()]);
  return (
    // Clipped sideways so a tilted sticker never widens the page on a phone.
    <main className="mx-auto w-full max-w-[1400px] overflow-x-clip px-4 pt-24 pb-24 md:px-8">
      <Scrapbook photos={photos} countriesVisited={now.countriesVisited} place={now.place} />
    </main>
  );
}
