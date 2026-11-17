import type { Metadata } from "next";
import Link from "next/link";
import { Prompt, Tile } from "@/components/board/Tile";
import { focusRing } from "@/components/ui/sticker";

export const metadata: Metadata = {
  title: "About me redesigns (lab)",
  robots: { index: false, follow: false },
};

const concepts = [
  { href: "/about-lab/scrapbook", command: "open scrapbook", name: "Scrapbook", idea: "Fact stickers and album photos in a collage. Tap a sticker for the longer story." },
  { href: "/about-lab/chapters", command: "open chapters", name: "Chapters", idea: "Your story as short chapters you scroll through, one photo and a few lines each." },
  { href: "/about-lab/ask-me", command: "open ask-me", name: "Ask me", idea: "Visitors tap questions like \"why Estonia?\" and a short answer pops up." },
  { href: "/#about", command: "open current", name: "Current About", idea: "Today's version, for comparison." },
];

export default function AboutLab() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-16 pb-32 md:px-8">
      <h1 className="text-4xl leading-none font-bold tracking-[-0.04em] text-ink md:text-5xl">About me: three ideas</h1>
      <p className="mt-4 max-w-[60ch] leading-relaxed text-mute">Hidden preview pages. Open each one on your phone and on a laptop, then pick a favorite or mix parts.</p>
      <ul className="mt-10 grid gap-5 md:grid-cols-2">
        {concepts.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className={`block rounded-tile ${focusRing}`}>
              <Tile core="bg-surface p-6 transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none">
                <Prompt className="text-mute">{c.command}</Prompt>
                <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">{c.name}</h2>
                <p className="mt-2 leading-relaxed text-mute">{c.idea}</p>
              </Tile>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
