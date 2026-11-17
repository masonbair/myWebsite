import type { StickerFill } from "./copy";

export const fills: Record<StickerFill, string> = {
  surface: "bg-surface text-ink",
  tea: "bg-tea text-night",
  rose: "bg-rose text-night",
  accent: "bg-accent text-night",
};

/** Secondary text: mute on surface, night on the fixed brand fills (mute drops below 4.5:1 there in dark mode). */
export const softText = (fill: StickerFill) => (fill === "surface" ? "text-mute" : "text-night/80");
