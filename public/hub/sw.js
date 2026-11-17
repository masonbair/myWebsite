// Only the offline pages and build files are cached, never API or other signed-in data; Samsung Internet installs only with a fetch handler.
const CACHE = "hub-v1";
const CAPTURE = "/hub/capture";
// Walk holds the day's prompts inside its HTML, so the saved copy is the deck Mason saw last with signal.
const OFFLINE_PAGES = [CAPTURE, "/hub/walk"];
// The page names some files as "static/chunks/..." inside its React payload, without the /_next/ prefix.
const STATIC_ASSET = /static\/(?:chunks|css|media)\/[^"'\s\\]+?\.(?:js|css|woff2)/g;

// Only the plain page becomes the offline copy; a share-target visit (/hub/capture?share=empty) renders differently.
function offlinePagePath(response) {
  if (!response.ok || response.redirected) return null;
  const url = new URL(response.url);
  return OFFLINE_PAGES.includes(url.pathname) && url.search === "" ? url.pathname : null;
}

const samePath = (path) => decodeURI(path);
const CACHED_AT = "x-hub-cached-at";
// Code can fetch a script after the HTML was read, so a build file cached this recently is never pruned.
const KEEP_FRESH_MS = 10 * 60 * 1000;

async function putStamped(cache, request, response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));
  const body = await response.blob();
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
}

async function cacheAsset(cache, path) {
  const response = await fetch(path);
  if (response.ok) await putStamped(cache, path, response);
}

async function isFresh(cache, request) {
  const cached = await cache.match(request);
  const at = Number(cached?.headers.get(CACHED_AT));
  return at > 0 && Date.now() - at < KEEP_FRESH_MS;
}

const assetsNamedIn = (html) => [...new Set((html.match(STATIC_ASSET) ?? []).map((path) => `/_next/${path}`))];

// Caches one offline page plus the scripts and styles it names, then drops build files no saved page names so old deploys don't pile up.
async function cachePage(path, response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(path, response);
  await Promise.all(assetsNamedIn(html).map((asset) => cacheAsset(cache, asset).catch(() => undefined)));
  const keep = new Set();
  for (const page of OFFLINE_PAGES) {
    const saved = await cache.match(page);
    if (saved) for (const asset of assetsNamedIn(await saved.text())) keep.add(samePath(asset));
  }
  const unnamed = (await cache.keys()).filter((request) => {
    const assetPath = new URL(request.url).pathname;
    return assetPath.startsWith("/_next/static/") && !keep.has(samePath(assetPath));
  });
  for (const request of unnamed) {
    if (!(await isFresh(cache, request))) await cache.delete(request);
  }
}

async function cacheIfOffline(response) {
  const path = offlinePagePath(response);
  if (path) await cachePage(path, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all(
      OFFLINE_PAGES.map((path) =>
        fetch(path, { credentials: "same-origin" })
          .then(cacheIfOffline)
          .catch(() => undefined),
      ),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("hub-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// A tab tap inside the app loads no full page, so an offline page asks to be saved when it opens.
self.addEventListener("message", (event) => {
  const path = event.data?.savePage;
  if (!OFFLINE_PAGES.includes(path)) return;
  event.waitUntil(
    fetch(path, { credentials: "same-origin" })
      .then(cacheIfOffline)
      .catch(() => undefined),
  );
});

async function navigate(event) {
  try {
    const response = await fetch(event.request);
    if (offlinePagePath(response)) event.waitUntil(cacheIfOffline(response.clone()));
    return response;
  } catch (error) {
    const path = new URL(event.request.url).pathname;
    const cached = (OFFLINE_PAGES.includes(path) && (await caches.match(path))) || (await caches.match(CAPTURE));
    if (cached) return cached;
    throw error;
  }
}

async function staticAsset(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => putStamped(cache, request, copy));
    }
    return response;
  } catch (error) {
    // Script loaders may percent-encode characters like [ that the page HTML spells plainly.
    const cached = (await caches.match(request)) ?? (await caches.match(decodeURI(request.url)));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (request.mode === "navigate" && path.startsWith("/hub/") && !path.startsWith("/hub/auth/")) {
    event.respondWith(navigate(event));
  } else if (path.startsWith("/_next/static/")) {
    event.respondWith(staticAsset(request));
  }
});
