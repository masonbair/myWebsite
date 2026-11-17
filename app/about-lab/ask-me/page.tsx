import type { Metadata } from "next";
import { AskMe } from "@/components/about-lab/ask-me/AskMe";

export const metadata: Metadata = {
  title: "About lab: ask me",
  robots: { index: false, follow: false },
};

export const revalidate = 3600;

export default function AskMeLab() {
  return (
    <main className="pb-48">
      <h1 className="sr-only">About Mason Bair</h1>
      <AskMe />
    </main>
  );
}
