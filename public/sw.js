/**
 * Keeps the app's own files on the phone, so a second visit on 2G/3G costs
 * only the data the conversation itself needs.
 *
 *  - /_next/static/*: content-hashed, never change — served from the cache.
 *  - The call worklet and icons: served from the cache, refreshed behind it.
 *  - Pages: always from the network; a copy of the public, prerendered ones is
 *    kept only so the app still opens when the network drops.
 *
 * Never cached: APIs, the voice socket, other sites, and any page rendered for
 * a particular person (kiosks are shared devices).
 */

const CACHE = "ks-v1";
const MAX_ENTRIES = 200;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function put(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);

  // Old builds' chunks pile up across deploys; drop the oldest.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(key);
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event) {
  const hit = await caches.match(event.request);
  const fresh = fetch(event.request).then(async (response) => {
    if (response.ok) await put(event.request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    // Prerendered = the same for everyone, so safe to keep on a shared device.
    if (response.ok && response.headers.get("x-nextjs-prerender")) {
      await put(request, response.clone());
    }
    return response;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname === "/call-worklet.js" || url.pathname === "/favicon.ico") {
    event.respondWith(staleWhileRevalidate(event));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  }
  // Everything else (APIs, RSC payloads, the voice socket) goes straight to the network.
});
