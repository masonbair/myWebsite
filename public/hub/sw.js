// Only the capture page and build files are cached, never API or other signed-in data; Samsung Internet installs only with a fetch handler.
const CACHE = "hub-v1";
const CAPTURE = "/hub/capture";
// The page names some files as "static/chunks/..." inside its React payload, without the /_next/ prefix.
const STATIC_ASSET = /static\/(?:chunks|css|media)\/[^"'\s\\]+?\.(?:js|css|woff2)/g;

// Only the plain page becomes the offline copy; a share-target visit (/hub/capture?shared=1) renders differently.
function isCapturePage(response) {
  if (!response.ok || response.redirected) return false;
  const url = new URL(response.url);
  return url.pathname === CAPTURE && url.search === "";
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

// Caches the capture page plus the scripts and styles it names, then drops build files it no longer names so old deploys don't pile up.
async function cacheCapture(response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(CAPTURE, response);
  const assets = [...new Set((html.match(STATIC_ASSET) ?? []).map((path) => `/_next/${path}`))];
  await Promise.all(assets.map((path) => cacheAsset(cache, path).catch(() => undefined)));
  const keep = new Set(assets.map(samePath));
  const unnamed = (await cache.keys()).filter((request) => {
    const path = new URL(request.url).pathname;
    return path.startsWith("/_next/static/") && !keep.has(samePath(path));
  });
  for (const request of unnamed) {
    if (!(await isFresh(cache, request))) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(CAPTURE, { credentials: "same-origin" })
      .then((response) => (isCapturePage(response) ? cacheCapture(response) : undefined))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
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

async function navigate(event) {
  try {
    const response = await fetch(event.request);
    if (isCapturePage(response)) event.waitUntil(cacheCapture(response.clone()));
    return response;
  } catch (error) {
    const cached = await caches.match(CAPTURE);
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
