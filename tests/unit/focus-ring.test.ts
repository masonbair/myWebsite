import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tailwind v4's outline-none sets --tw-outline-style: none, and focus-visible:outline-2 only sets a width, so the ring never draws.
const RING_WIDTH = /focus-visible:outline-(?:\d+|\[[^\]]+\])(?![\w-])/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|ts)$/.test(name) ? [path] : [];
  });
}

describe("focus rings", () => {
  it("every class string with outline-none and a focus ring width also sets focus-visible:outline-solid", () => {
    const bad = sources("app")
      .concat(sources("components"))
      .flatMap((file) =>
        (readFileSync(file, "utf8").match(/["`][^"`]*["`]/g) ?? [])
          .filter((s) => s.includes("outline-none") && RING_WIDTH.test(s) && !s.includes("focus-visible:outline-solid"))
          .map((s) => `${file}: ${s.slice(0, 80)}`),
      );
    expect(bad, "add focus-visible:outline-solid next to the ring width").toEqual([]);
  });
});
