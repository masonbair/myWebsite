import Image from "next/image";
import { Tile } from "../Tile";

export function HelloTile() {
  return (
    <Tile core="min-h-[30rem] bg-night lg:min-h-0">
      <Image
        src="/misc/Mason_web.webp"
        alt="Mason standing on a glass ledge high above the Manhattan skyline"
        fill
        preload
        sizes="(min-width: 1400px) 700px, (min-width: 1024px) 50vw, 100vw"
        className="object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-night/90 via-night/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
        <h1 className="text-4xl leading-none font-extrabold tracking-tighter text-snow md:text-5xl lg:text-6xl">
          Hi, I&apos;m Mason.
        </h1>
        <p className="mt-3 max-w-[38ch] text-base leading-relaxed text-snow/90 md:text-lg">
          I&apos;m a software engineer who bakes, travels, and builds from wherever I land. Glad you&apos;re here.
        </p>
      </div>
    </Tile>
  );
}
