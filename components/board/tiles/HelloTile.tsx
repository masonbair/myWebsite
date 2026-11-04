import { getImageProps } from "next/image";
import { preload } from "react-dom";
import { Tile } from "../Tile";

// Below this width the tile is taller than wide, so a portrait crop shows the same view at about a third of the bytes.
// Range syntax so fractional viewport widths (e.g. 479.5px) still match one of the two.
const PHONE = "(width < 480px)";
const WIDER = "(width >= 480px)";

const alt = "Mason standing on a glass ledge high above the Manhattan skyline";

// The landscape photo covers a near-square tile, so its rendered width follows the tile height, not the viewport width.
const { props: wide } = getImageProps({
  src: "/misc/Mason_web.webp",
  alt,
  fill: true,
  sizes: "(min-width: 1024px) 1024px, 860px",
});
// The 4:5 crop fills the tile width (viewport minus page and tile padding) on phones from about 430px up; below that it shows 384px wide.
const { props: phone } = getImageProps({
  src: "/misc/Mason_web_portrait.webp",
  alt,
  fill: true,
  sizes: "calc(100vw - 32px)",
});

export function HelloTile() {
  // Media-scoped preloads so each screen fetches only the file its <source> will pick.
  preload(phone.src, { as: "image", imageSrcSet: phone.srcSet, imageSizes: phone.sizes, media: PHONE, fetchPriority: "high" });
  preload(wide.src, { as: "image", imageSrcSet: wide.srcSet, imageSizes: wide.sizes, media: WIDER, fetchPriority: "high" });

  return (
    <Tile core="min-h-[30rem] bg-night lg:min-h-0">
      <picture>
        <source media={PHONE} srcSet={phone.srcSet} sizes={phone.sizes} />
        <img {...wide} alt={alt} fetchPriority="high" loading="eager" className="object-cover" />
      </picture>
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
