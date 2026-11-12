import type { Page } from "@playwright/test";

/** How many row lines of the wide board grid are not covered edge to edge by tiles (holes); 0 means no holes. */
export function boardRowGaps(page: Page): Promise<number> {
  return page.locator("[data-board-grid]").evaluate((grid) => {
    // Layout boxes, not getBoundingClientRect: tiles swinging in on scroll are transformed mid-animation.
    const box = (el: HTMLElement) => ({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight, width: el.offsetWidth });
    const g = box(grid as HTMLElement);
    const gap = parseFloat(getComputedStyle(grid).columnGap);
    const tiles = Array.from(grid.children).map((el) => box(el as HTMLElement));
    const tops = [...new Set(tiles.map((t) => Math.round(t.top)))];
    // Every row line, tall tiles included, must cover the grid's full width.
    return tops.filter((y) => {
      const across = tiles.filter((t) => t.top <= y + 1 && t.bottom > y + 1);
      const covered = across.reduce((sum, t) => sum + t.width, 0) + gap * (across.length - 1);
      return Math.abs(covered - g.width) > 2;
    }).length;
  });
}
