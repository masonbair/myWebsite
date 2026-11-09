import type { Metadata } from "next";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Prompt, Tile } from "@/components/board/Tile";
import { buttonBubble, stickerButton } from "@/components/ui/sticker";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-28 pb-24 md:pt-36">
      <Tile tilt="left" core="flex flex-col gap-5 bg-tea p-7 text-night md:p-10">
        <Prompt>cd ./that-page</Prompt>
        <h1 className="text-4xl leading-none font-bold tracking-[-0.04em] md:text-5xl">Page not found</h1>
        <p className="text-lg leading-relaxed">This page does not exist. It may have moved, or the link has a typo.</p>
        <Link href="/" className={`${stickerButton} mt-2 self-start`}>
          Back to the home page
          <span className={buttonBubble}>
            <ArrowLeft weight="bold" size={16} aria-hidden />
          </span>
        </Link>
      </Tile>
    </main>
  );
}
