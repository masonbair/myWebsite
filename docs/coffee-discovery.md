# Coffee chat discovery: Mason's checklist

The site side is built: niche sections on `/coffee` (`#devsecops`, `#nomad`, `#kent-state`), a longer FAQ, a visible
"Last updated" date, booking data agents can read, a book-by-email fallback, `llms.txt`, and IndexNow.

What's left only you can do. Broad questions like "find me someone for a coffee chat" mostly get answered with
platforms (ADPList, LinkedIn, Reddit), so listings that link to `https://masonbair.com/coffee` matter most.

## When you change the coffee page

1. Edit copy in `content/coffee.ts`.
2. Bump `coffeeUpdated` in the same file. It drives the visible "Last updated" line, `dateModified`, and the sitemap.
3. After the production deploy, run `npm run indexnow` (tells Bing and other IndexNow engines to recrawl).

## One-time setup

### Bing Webmaster Tools (feeds Copilot, likely ChatGPT search)

1. Go to bing.com/webmasters and sign in.
2. Add site: choose **Import from Google Search Console** if that's set up, or add `https://masonbair.com` and
   verify with the DNS TXT record (Vercel dashboard > Domains > masonbair.com > DNS records).
3. Sitemaps > submit `https://masonbair.com/sitemap.xml`.
4. IndexNow: nothing to set up in Bing. The key file is already live at
   `https://masonbair.com/ff299680043c902e40ce6cb93c5e40b2.txt` after deploy. Run `npm run indexnow` once; Bing's
   IndexNow page should then show the submitted URLs within a day.
5. Check the **AI Performance** report (Copilot citations) once a month.

### Google Search Console (feeds Gemini and AI Mode)

1. search.google.com/search-console > Add property > **Domain** > `masonbair.com`.
2. Verify with the DNS TXT record in Vercel.
3. Sitemaps > submit `https://masonbair.com/sitemap.xml`.
4. URL Inspection > `https://masonbair.com/coffee` > Request indexing.

## Listings (do once, keep current)

- [ ] **ADPList** (free mentoring platform): make a mentor profile. Put the `/coffee` link in your bio. List the same
      topics: DevSecOps, hackathons, CS careers, remote work while traveling.
- [ ] **LinkedIn headline**: add "Open to coffee chats". Example: "Software Engineer | DevSecOps | Open to coffee
      chats: masonbair.com/coffee".
- [ ] **LinkedIn Featured**: add `/coffee` as a link with a one-line description.
- [ ] **LinkedIn post**: one short post saying you take coffee chats and who they're for, with the link. Once.
- [ ] **GitHub profile README** (`masonbair/masonbair` repo): add a "Coffee chat" section with one line and the link.
- [ ] **Kent Hack Enough / HacKSU / Kent State CS**: ask for a mention on an alumni or mentor page, linking `/coffee`.
- [ ] **Devpost**: add the `/coffee` link to your profile's website field.

Once a Devpost or Kent Hack Enough page about you exists, send the URL and it gets added to the site's `sameAs`
(the list that ties your profiles together for search engines).

## Reddit and Hacker News etiquette

- Answer the question first. Only link `/coffee` when someone asks for a chat or mentorship and it really fits.
- One link per thread. Never repost the same text across threads or subreddits.
- Good places: r/cscareerquestions, r/csMajors, r/digitalnomad, r/devops, r/devsecops, r/KentState. Read each
  subreddit's self-promotion rule before posting.
- Hacker News: don't post the page itself. A link in your HN profile "about" field is fine, and so is a relevant
  comment in a monthly "Ask HN" mentoring or career thread.
- If a mod removes it, don't repost.

## Monthly test prompts

Run each in ChatGPT, Claude, Perplexity, Gemini, and Copilot, signed out or in a fresh chat. Log the date, the
assistant, whether you or `/coffee` came up, and what it cited.

1. "Find a software engineer who does coffee chats about DevSecOps."
2. "Who can I talk to about becoming a digital nomad software engineer?"
3. "Kent State CS grad open to coffee chats."
4. "Someone to chat with about running a hackathon."
5. "Who is Mason Bair?"
6. "Book a coffee chat with Mason Bair." (Checks whether an agent finds the booking link or the email fallback.)

Also check: Bing AI Performance report, Google Search Console queries for `/coffee`, and hub analytics for visits from
`ChatGPT-User`, `Claude-User`, and `Perplexity-User`.

## Still open

- Whether the chat is free. The page doesn't say so until you confirm.
- Whether to answer "Do you hire or give referrals?" on the page.
- Moving booking to Cal.com (gives agents real open times). Not changed; the email fallback covers text-only agents for now.
