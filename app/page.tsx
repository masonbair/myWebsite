import type { Metadata } from "next";
import { Board } from "@/components/board/Board";
import { LazyCatGame } from "@/components/game/LazyGame";
import { JsonLd } from "@/components/JsonLd";
import { About } from "@/components/sections/About";
import { Achievements } from "@/components/sections/Achievements";
import { Resume } from "@/components/sections/Resume";
import { Work } from "@/components/sections/Work";
import { siteUpdated } from "@/content/site";
import { getBoard } from "@/lib/board";
import { homeJsonLd } from "@/lib/jsonld";

export const revalidate = 3600;

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const board = await getBoard();
  return (
    <>
      {/* The tall bottom padding keeps the last section clear of the corner cat. */}
      <main className="pt-24 pb-48">
        <JsonLd data={homeJsonLd(new Date(siteUpdated))} />
        <Board board={board} />
        <About />
        <Work />
        <Achievements />
        <Resume />
      </main>
      <LazyCatGame />
    </>
  );
}
