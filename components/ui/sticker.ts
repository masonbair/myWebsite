export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

/** Pill with an accent offset shadow that lifts on hover and presses in on click; add border and fill colors. */
export const stickerButtonShape = `group inline-flex items-center gap-3 rounded-full border-[2.5px] py-1.5 pr-1.5 pl-5 text-base font-bold whitespace-nowrap shadow-cta transition-[translate,box-shadow] duration-200 ease-spring hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--color-accent)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_var(--color-accent)] motion-reduce:transition-none ${focusRing}`;

/** Ink pill: inverts with the theme. */
export const stickerButton = `${stickerButtonShape} border-line bg-ink text-canvas`;

/** Round tea bubble at the end of a sticker button. */
export const buttonBubble = "flex size-9 items-center justify-center rounded-full bg-tea text-night";

/** Small outlined label; add border, fill and text size (usually text-[11px]). */
export const tag =
  "inline-block rounded-full border-2 px-2.5 py-0.5 leading-snug font-bold tracking-[0.04em] whitespace-nowrap";
