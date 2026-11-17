import { Bread } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { Prompt, Tile } from "@/components/board/Tile";
import { tag } from "@/components/ui/sticker";
import now from "@/content/now.json";
import { role } from "@/content/site";
import type { StickerKind } from "./copy";

const nightTag = `${tag} border-night bg-snow text-xs text-night`;

const Big = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 max-w-[12ch] text-4xl leading-[0.95] font-bold tracking-[-0.04em] md:text-5xl">{children}</p>
);

const Tags = ({ items }: { items: string[] }) => (
  <p className="flex flex-wrap gap-2">
    {items.map((t) => (
      <span key={t} className={nightTag}>
        {t}
      </span>
    ))}
  </p>
);

const stickers: Record<StickerKind, { fill: string; body: ReactNode }> = {
  hacksu: {
    fill: "bg-accent",
    body: (
      <>
        <div>
          <Prompt>cat hacksu.txt</Prompt>
          <Big>HacKSU president</Big>
        </div>
        <Tags items={["11 other organizers", "Kent Hack Enough"]} />
      </>
    ),
  },
  estonia: {
    fill: "bg-rose",
    body: (
      <>
        <div>
          <Prompt>whereami --2024</Prompt>
          <Big>Tartu, Estonia</Big>
        </div>
        <div className="flex items-end justify-between gap-4">
          <p className="font-bold">
            {/* Comma in sans: JetBrains Mono gives it a full digit slot. */}
            <span className="font-mono text-4xl leading-none tracking-tight">
              $12<span className="font-sans">,</span>000+
            </span>
            <br />
            in scholarships
          </p>
          <span className={nightTag}>2 semesters</span>
        </div>
      </>
    ),
  },
  fullsend: {
    fill: "bg-tea",
    body: (
      <>
        <div>
          <Prompt>whoami</Prompt>
          <Big>{role.title}</Big>
        </div>
        <Tags items={[role.employerFull, "Fully remote"]} />
      </>
    ),
  },
  nomad: {
    fill: "bg-accent",
    body: (
      <>
        <div>
          <Prompt>whereami</Prompt>
          <Big>Working from the road</Big>
        </div>
        <p className="grid size-28 -rotate-[10deg] place-items-center self-end rounded-full border-[3px] border-dashed border-night text-center text-sm leading-tight font-bold">
          <span>
            <span className="font-mono text-4xl leading-none">{now.countriesVisited}</span>
            <br />
            countries
          </span>
        </p>
      </>
    ),
  },
  bake: {
    fill: "bg-tea",
    body: (
      <>
        <div>
          <Bread size={40} weight="light" aria-hidden />
          <Big>Banana bread, pumpkin bread</Big>
        </div>
        <Tags items={["Sweetened with honey", "No white sugar"]} />
      </>
    ),
  },
};

/** A fixed-color sticker standing in for a chapter photo; hidden from screen readers because its facts are in the chapter text. */
export function ChapterSticker({ kind, tilt }: { kind: StickerKind; tilt: "left" | "right" }) {
  const { fill, body } = stickers[kind];
  return (
    <div aria-hidden className="max-w-md">
      <Tile tilt={tilt} core={`flex min-h-72 flex-col justify-between gap-8 p-6 text-night sm:aspect-square sm:min-h-0 md:p-8 ${fill}`}>
        {body}
      </Tile>
    </div>
  );
}
