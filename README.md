# masonbair.com

My personal website: a Next.js app (App Router, Tailwind CSS, TypeScript).

## Deploy

The site is deployed on Vercel.

## Local development

Needs Node 24 (see the `engines` field in package.json).

```bash
npm install
npm run dev     # local server at http://localhost:3000
npm test        # unit tests (Vitest)
npm run e2e     # browser tests (Playwright)
npm run build   # production build
npm run lint    # ESLint
```

Optional settings go in `.env.local`:

- `GITHUB_TOKEN` shows recent GitHub activity on the home page. Without it, the page links to GitHub instead.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `LEADERBOARD_SALT` turn on the shared cat game leaderboard. Without them, scores save on the device only.

The "right now" board reads `content/now.json`.
