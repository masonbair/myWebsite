<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Lessons from past debugging live in docs/lessons/. Before debugging or planning in an area, run: grep -h '^title:\|^applies_when:' docs/lessons/*.md

## Design

Every page of the site and the hub uses one design: the Sticker Board. Before any UI work, read the design system's `project/README.md` at https://claude.ai/artifact/1gk5hP4kJoqKbbr7HJJJBS. Build from its tokens and components, which live in code as `app/globals.css` (colors, shadows, radius), `components/board/Tile.tsx` (`Tile`, `Prompt`), `components/ui/sticker.ts` (buttons, tags, focus ring) and `components/hub/styles.ts` (hub panels, rows, buttons, fields). Do not add new ad-hoc colors, shadows or one-off styles.
