export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

export const panel = "rounded-tile border-[2.5px] border-line bg-surface shadow-tile";

/** Small sticker for rows and chips inside a page. */
export const sticker = "rounded-2xl border-[2.5px] border-line shadow-sticker-sm";

export const primaryButton = `inline-flex h-10 items-center gap-2 rounded-full border-[2.5px] border-line bg-accent px-5 text-sm font-bold text-night shadow-sticker-sm transition-[translate,box-shadow] duration-200 ease-spring active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-60 ${focusRing}`;

export const quietButton = `inline-flex h-10 items-center gap-2 rounded-full border-2 border-line bg-surface px-5 text-sm font-semibold text-ink transition-[translate,background-color] duration-200 ease-spring hover:bg-canvas active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-60 ${focusRing}`;

export const smallButton = `inline-flex h-9 items-center rounded-full border-2 border-line bg-surface px-3.5 text-sm font-semibold text-ink transition-colors duration-200 ease-spring hover:bg-canvas disabled:opacity-60 ${focusRing}`;

export const field = `h-9 rounded-xl border-2 border-line bg-canvas px-3 text-sm text-ink placeholder:text-mute focus-visible:ring-2 focus-visible:ring-accent-ink outline-none`;
