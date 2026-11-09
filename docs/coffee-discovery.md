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

- Whether to answer "Do you hire or give referrals?" on the page.
- Moving booking to Cal.com. Plan below; nothing changes on the site until you've made the account.

## Plan: book through Cal.com, keep Google Calendar

Your Google Calendar stays the source of truth. Cal.com only replaces the booking page: it reads your Google
Calendar to hide busy times, and every booking lands in Google Calendar with a Google Meet link.

**Why bother:** the Google booking page shows open times only after JavaScript runs, and it has no public API, so
assistants can't see or book a time. Cal.com has a public "open times" API that needs no key. Checked on
2026-11-09: a plain request to `https://api.cal.com/v2/slots?username=<user>&eventTypeSlug=<slug>&start=...&end=...`
with the header `cal-api-version: 2024-09-04` returned a real public user's open times without logging in.

### Your steps (about 15 minutes, free plan)

1. Sign up at cal.com with your Google account. Pick a username (e.g. `masonbair`).
2. Settings > Calendars: connect Google Calendar. Turn on "check for conflicts" for every calendar that holds busy
   time, and set your main calendar as the one that new events are added to.
3. Apps: install **Google Meet** and make it the default location (it needs the Google Calendar connection from step 2).
4. Availability: copy your current coffee-chat hours. Set your time zone, and update it when you travel (or turn on
   "travel schedule" if offered).
5. Event types: make one called "Coffee chat", 30 minutes, slug `coffee`. Add booking questions:
   "What would you like to talk about?" and "How did you find me?" (both required).
6. Set limits so you don't get flooded: e.g. at most 3 per day, at least 12 hours' notice, up to 30 days ahead.
7. Book yourself a test slot from a second email. Check that it shows up in Google Calendar with a Meet link, then
   cancel it.
8. Send the coordinator the final link (e.g. `https://cal.com/masonbair/coffee`). Keep the Google booking page
   live for a couple of weeks so old links still work.

### What changes on the site after that

- `bookingUrl` in `content/coffee.ts` becomes the Cal.com link. The Book button, the JSON-LD booking entry point
  (`ScheduleAction` target), and `llms.txt` all read from it or get updated with it, and tests check they match.
- The button label changes from "on Google Calendar" to "on Cal.com". The FAQ time zone answer stays true
  (Cal.com also shows times in the visitor's time zone).
- `llms.txt` gains a line telling agents how to read open times from the slots API for your username and slug.
- The book-by-email fallback stays as is.
- No new dependencies, keys, or environment variables: the slots API is read straight by the agent, not by the site.

### Can agents see open times then?

- **Yes, browsing agents** (ChatGPT agent, Claude in Chrome, Perplexity Comet): the Cal.com page lists open times
  and they can pick one.
- **Yes, text-only agents** can read open times from the slots API above, with no key.
- **Booking without a browser:** Cal.com's API can also create a booking for a public event type. Not tested yet;
  test it once your account exists before telling agents about it in `llms.txt`.

