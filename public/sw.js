// Keeps the app itself on the device, so it starts with no connection. Books are kept separately
// (src/lib/bookCache.ts) and everything from other sites (the server, voice model) is left alone.
const CACHE = "ribbon-app-v1";
const INDEX = self.registration.scope;
// Hashed files from past releases: enough for this one, without growing forever.
const MAX_BUILD_FILES = 80;
// The reader's own code, loaded only once a book is opened.
const READER = ["view", "paginator", "epub", "epubcfi", "mobi", "fb2", "comic-book", "fixed-layout", "pdf", "overlayer", "progress", "search", "text-walker", "vendor/zip", "vendor/fflate"].map(
  (f) => new URL(`foliate-js/${f}.js`, INDEX).href,
);

const keep = async (urls) => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(urls.map((u) => cache.add(u)));
};

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(keep([INDEX, ...READER]));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => Array.isArray(e.data) && e.waitUntil(keep(e.data)));

async function fetchAndKeep(request, key = request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(key, response.clone());
    const built = (await cache.keys()).filter((k) => new URL(k.url).pathname.includes("/assets/"));
    await Promise.all(built.slice(0, Math.max(0, built.length - MAX_BUILD_FILES)).map((k) => cache.delete(k)));
  }
  return response;
}

// The page: the newest there is, unless the network is gone or too slow to wait for.
async function page(request) {
  const network = fetchAndKeep(request, INDEX);
  const cached = caches.match(INDEX);
  const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(() => cached);
  const response = await Promise.race([network.catch(() => cached), slow]);
  return response ?? network;
}

// Everything else: what's kept, refreshed in the background unless its name has its content's hash.
async function file(request) {
  // Scripts are asked for with different headers from those they were stored under.
  const cached = await caches.match(request, { ignoreVary: true });
  if (!cached) return fetchAndKeep(request);
  if (!new URL(request.url).pathname.includes("/assets/")) fetchAndKeep(request).catch(() => {});
  return cached;
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  e.respondWith(request.mode === "navigate" ? page(request) : file(request));
});
