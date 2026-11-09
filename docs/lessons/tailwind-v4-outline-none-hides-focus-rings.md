---
title: In Tailwind v4, outline-none plus focus-visible:outline-2 draws no focus ring; add focus-visible:outline-solid.
applies_when: Writing or copying a focus style that pairs outline-none with a focus-visible:outline-<width> utility.
date: 2026-11-09
---

**Symptom:** Tabbing through the site showed no focus ring anywhere, even though every control had `focus-visible:outline-2 focus-visible:outline-accent-ink`. Computed style on the focused element: `outline-style: none`, width and color set. axe and Lighthouse accessibility both scored 100.

**Cause:** In Tailwind v4, `outline-none` compiles to `--tw-outline-style: none; outline-style: none`, and `focus-visible:outline-2` compiles to `outline-style: var(--tw-outline-style); outline-width: 2px`. The width utility only re-reads the variable the base class already set to `none`. (v3's `outline-none` was a transparent outline, so the old pattern worked there.)

**Do instead:** Add `focus-visible:outline-solid` next to the width, or use the shared `focusRing` / `focusRingOnColor` strings in `components/ui/sticker.ts`. On tea, accent or rose stickers use `focusRingOnColor` (night ink), since the accent-ink ring is about 1.1:1 there in dark mode.

**Evidence:** Fixed in commit ffd1152 on branch sticker-polish. `tests/unit/focus-ring.test.ts` scans every class string under app/ and components/. The e2e test "keyboard focus draws a visible outline" in tests/e2e/shell.spec.ts tabs through /coffee. Both fail when `focus-visible:outline-solid` is removed and pass with it.
