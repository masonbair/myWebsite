import { Board } from "@/components/board/Board";
import { getBoard } from "@/lib/board";

export const revalidate = 3600;

export default async function Home() {
  const board = await getBoard();
  return (
    <main className="pt-24 pb-24">
      <Board board={board} />
    </main>
  );
}
