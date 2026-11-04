import type { ReactNode } from "react";

export const sectionShell = "mx-auto w-full max-w-[1400px] scroll-mt-2 px-4 pt-28 md:px-8 md:pt-36";

/** Page section with the shared container; `pt-28` keeps anchored headings clear of the floating nav. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={sectionShell}>
      <h2 id={`${id}-title`} className="text-4xl leading-none font-bold tracking-tighter text-ink md:text-5xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Chips({ items, className = "bg-ink/5 text-mute" }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className={`rounded-full px-3 py-1 text-xs font-medium ${className}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}
