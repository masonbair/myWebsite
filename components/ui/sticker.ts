export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

/** Ink pill with an accent offset shadow that lifts on hover and presses in on click. */
export const stickerButton = `group inline-flex items-center gap-3 rounded-full border-[2.5px] border-line bg-ink py-1.5 pr-1.5 pl-5 text-base font-bold whitespace-nowrap text-canvas shadow-cta transition-[translate,box-shadow] duration-200 ease-spring hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--color-accent)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_var(--color-accent)] motion-reduce:transition-none ${focusRing}`;

/** Round tea bubble at the end of a sticker button. */
export const buttonBubble = "flex size-9 items-center justify-center rounded-full bg-tea text-night";

/** Small outlined label; pair with a fill class such as bg-tea for colored tags. */
export const tag =
  "inline-block rounded-full border-2 border-line px-2.5 py-0.5 text-[11px] leading-snug font-bold tracking-[0.04em] whitespace-nowrap";
