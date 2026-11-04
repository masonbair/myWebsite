import { Board } from "@/components/board/Board";
import { LazyCatGame } from "@/components/game/LazyGame";
import { About } from "@/components/sections/About";
import { Achievements } from "@/components/sections/Achievements";
import { Resume } from "@/components/sections/Resume";
import { Work } from "@/components/sections/Work";
import { getBoard } from "@/lib/board";

export const revalidate = 3600;

export default async function Home() {
  const board = await getBoard();
  return (
    <>
      {/* The tall bottom padding keeps the last section clear of the corner cat. */}
      <main className="pt-24 pb-48">
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
