import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { coffeeChat, hello } from "@/content/site";
import { buttonBubble, stickerButton, tag } from "@/components/ui/sticker";
import { Tile } from "../Tile";

export function HelloTile() {
  return (
    <Tile core="flex flex-col bg-surface p-6 md:p-9">
      <span className={`${tag} self-start border-line bg-tea text-night`}>{hello.tag}</span>
      <h1 className="mt-5 text-5xl leading-[0.98] font-bold tracking-[-0.04em] text-ink md:mt-6 md:text-7xl xl:text-8xl">
        {hello.heading}
      </h1>
      <p className="mt-4 max-w-[40ch] text-lg leading-relaxed text-mute md:text-xl">{hello.body}</p>
      {/* A plain anchor keeps next/link (about 7 KB) off the home page. */}
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 md:mt-auto md:pt-8">
        <a href={coffeeChat.href} className={stickerButton}>
          {coffeeChat.label}
          <span className={buttonBubble}>
            <ArrowUpRight weight="bold" size={16} aria-hidden />
          </span>
        </a>
        <span className="font-semibold text-mute">{hello.note}</span>
      </div>
    </Tile>
  );
}
