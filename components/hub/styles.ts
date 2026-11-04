export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const panel = "rounded-tile bg-surface shadow-tile ring-1 ring-ink/5";

export const primaryButton = `inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-night transition-[opacity,transform] duration-300 ease-spring hover:opacity-90 active:scale-[0.98] disabled:opacity-60 ${focusRing}`;

export const quietButton = `inline-flex h-10 items-center gap-2 rounded-full bg-ink/5 px-5 text-sm font-semibold text-ink transition-[background-color,transform] duration-300 ease-spring hover:bg-ink/10 active:scale-[0.98] disabled:opacity-60 ${focusRing}`;

export const smallButton = `inline-flex h-9 items-center rounded-full bg-ink/5 px-3.5 text-sm font-medium text-ink transition-colors duration-300 ease-spring hover:bg-ink/10 disabled:opacity-60 ${focusRing}`;

export const field = `h-9 rounded-xl border-0 bg-canvas px-3 text-sm text-ink ring-1 ring-ink/10 placeholder:text-mute focus-visible:ring-2 focus-visible:ring-accent outline-none`;
