import type { ReactNode } from "react";

export const sectionShell = "mx-auto w-full max-w-[1400px] scroll-mt-2 px-4 pt-28 md:px-8 md:pt-36";

/** Page section with the shared container; `pt-28` keeps anchored headings clear of the floating nav. */
export function Section({ id, title, prompt, children }: { id: string; title: string; prompt?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={sectionShell}>
      {prompt && (
        <p aria-hidden className="mb-3 font-mono text-xs font-medium text-accent-ink">
          $ {prompt}
        </p>
      )}
      <h2 id={`${id}-title`} className="text-4xl leading-none font-bold tracking-[-0.04em] text-ink md:text-5xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Chips({ items, className = "border-line bg-surface text-ink" }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className={`rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold ${className}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}
