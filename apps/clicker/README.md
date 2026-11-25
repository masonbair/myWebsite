# clicker.masonbair.com

The page for Mason's grey Orb clicker game. It is a static Astro site with no server code, no trackers, and no scripts or fonts from other sites. It has its own Vercel project, like wamf.masonbair.com.

The look is direction B, "The Lit Room": the game's own dark room. Mason picked it on 2026-11-25. On purpose, this site is an exception to the Sticker Board Kit.

```bash
cd apps/clicker
npm ci
npm run dev      # http://localhost:4321 while editing
npm test         # build, then check the CSP rules, the search tags, the structured data, the links back and llms.txt
npm run preview  # serve the built site
```

## Where things live

| What | File |
|---|---|
| The game's name and every word on the page | `src/content.mjs` (the name is a working title; change `GAME.name` there) |
| "How we made it" card (off until Mason decides) | `SHOW_MAKING_OF` in `src/content.mjs` |
| Colors, type, layout | `src/styles/site.css` (colors from the game's style kit) |
| The tappable Orb | `src/scripts/orb.ts` |
| Search and social tags, structured data | `src/layouts/Base.astro`, the top of `src/pages/index.astro` |
| robots.txt, sitemap.xml, llms.txt | `src/pages/*.ts` (built from `content.mjs`) |
| Screenshots, social image | `public/shots/`, `public/og.jpg` (its 1200x630 source is a plain HTML file; it shows no game name, so a rename does not need a new one) |
| Security headers | `vercel.json` |

## Rules

- **Spoiler-free.** Show only the opening and the first hour. Ask Mason before showing anything later.
- **Not released.** Say "coming soon". No store links or dates until Mason gives them.
- **No inline scripts or styles.** The Content Security Policy (the rule list that says which files a page may load) allows only files from this site. A test checks this.

## Deploy (Mason does this; nothing here has been deployed)

1. **Make the Vercel project.** Vercel › Add New › Project › import `masonbair/myWebsite`.
   - Root Directory: `apps/clicker`. Framework preset: Astro. `vercel.json` sets the build settings.
   - No environment variables are needed.
   - Ignored Build Step: `git diff --quiet HEAD^ HEAD -- .` (rebuild only when this folder changes).
2. **Stop the main site rebuilding for clicker-only changes.** In the main masonbair.com project › Settings › Git › Ignored Build Step: `git diff --quiet HEAD^ HEAD -- . ':!apps'`.
3. **Add the domain.** Clicker project › Settings › Domains › add `clicker.masonbair.com`. Vercel shows a CNAME target.
4. **Point DNS at it (IONOS).** Domains & SSL › masonbair.com › DNS › Add record: Type `CNAME`, Host `clicker`, Points to: the exact target Vercel showed. Leave the main domain's records and MX records alone. Wait until Vercel shows the domain as valid and the certificate as issued.
5. **Check it live:**
   ```bash
   curl -sI https://clicker.masonbair.com/ | grep -i -E 'content-security-policy|strict-transport'
   curl -s https://clicker.masonbair.com/llms.txt | head -3
   ```
   Then paste the URL into Google's Rich Results Test and a social card preview.
6. **Merge the masonbair.com card only after step 5.** The same branch adds the game to masonbair.com's project list, linking here. Bump `siteUpdated` in `content/site.ts` to the merge day.
7. **Search Console (optional):** add `clicker.masonbair.com` as a property and submit `/sitemap.xml`.
