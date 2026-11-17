import type { Metadata } from "next";
import { Chapters } from "@/components/about-lab/chapters/Chapters";

export const metadata: Metadata = {
  title: "About me: chapters (lab)",
  robots: { index: false, follow: false },
};

export const revalidate = 3600;

export default function AboutChaptersLab() {
  return (
    <main className="pb-48">
      <Chapters />
    </main>
  );
}
