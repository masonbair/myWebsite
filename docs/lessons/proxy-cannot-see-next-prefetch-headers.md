---
title: In Next 16, proxy.ts never sees the rsc or next-router-prefetch headers, so it cannot spot prefetches by them
applies_when: writing proxy.ts logic that should treat prefetches or client-side navigations differently from full page loads (analytics, rate limits, logging)
date: 2026-11-09
---

**Symptom:** a `<Link>` prefetch (e.g. the home page prefetching /coffee) is counted as a real visit, although the code skips requests with `rsc` or `next-router-prefetch` headers. Unit tests pass because they set those headers by hand.
**Cause:** Next strips its Flight headers (`rsc`, `next-router-prefetch`, `next-router-state-tree`, ...) and the `_rsc` query from the request before calling the proxy (`node_modules/next/dist/server/web/adapter.js`, "Headers should only be stripped for middleware"; docs: proxy.md "RSC requests and rewrites").
**Do instead:** tell a browser's full page load apart by `sec-fetch-dest: document` (absent for bots, so only skip when it is present and not `document`). Client-side clicks between pages then aren't seen at all; `skipProxyUrlNormalize` keeps the headers, but it changes the URL shape for every proxy path.
**Evidence:** `lib/analytics/record.ts` `isPageRead`; e2e check in `tests/e2e/hub-analytics.spec.ts` (prefetch-style request with `sec-fetch-dest: empty` is not counted).
