// Only the capture page and build files are cached, never API or other signed-in data; Samsung Internet installs only with a fetch handler.
const CACHE = "hub-v1";
const CAPTURE = "/hub/capture";
// The page names some files as "static/chunks/..." inside its React payload, without the /_next/ prefix.
const STATIC_ASSET = /static\/(?:chunks|css|media)\/[^"'\s\\]+?\.(?:js|css|woff2)/g;

function isCapturePage(response) {
  return response.ok && !response.redirected && new URL(response.url).pathname === CAPTURE;
}

// Caches the capture page plus the scripts and styles it names, so it still runs offline.
async function cacheCapture(response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(CAPTURE, response);
  const assets = [...new Set((html.match(STATIC_ASSET) ?? []).map((path) => `/_next/${path}`))];
  await Promise.all(assets.map((path) => cache.add(path).catch(() => undefined)));
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
      caches.open(CACHE).then((cache) => cache.put(request, copy));
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
