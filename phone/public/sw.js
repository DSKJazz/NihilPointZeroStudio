/**
 * Offline shell for the NihilPointZero phone app.
 *
 * Caches only the app's own files so the icon opens instantly and shows a clear
 * message when there is no signal. AI requests are never cached — an answer is
 * always generated fresh, and a stale one would be worse than none.
 *
 * CACHE carries the build stamp, written in by scripts/build-phone.mjs. That is not
 * cosmetic: with a fixed name the previous version's files sit in the cache forever
 * under the same key, and an old app can outlive a publish. A new name means the
 * activate handler below deletes the old one outright.
 */
const CACHE = 'npz-phone-v1'
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individual misses must not fail the whole install, or one 404 leaves the
      // app permanently uninstallable.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(async () => {
        // Taking control is not the same as being SEEN. A tab that is already open
        // keeps running the old code it parsed at load, so the user goes on looking at
        // the previous version with no hint that anything changed. Tell every open tab
        // a new build has landed; the app decides what to do about it.
        for (const client of await self.clients.matchAll({ type: 'window' })) {
          client.postMessage({ type: 'npz-updated', cache: CACHE })
        }
      })
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Only ever serve our own origin from cache; AI calls go straight to the network.
  if (url.origin !== self.location.origin) return

  event.respondWith(
    // Network first, so a shipped fix reaches the phone on the next open, with the
    // cache as the offline safety net.
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined)
        return res
      })
      .catch(async () => {
        const hit = await caches.match(req)
        if (hit) return hit
        const shell = await caches.match('./index.html')
        if (shell) return shell
        return new Response('You are offline, and NihilPointZero has not been saved to this phone yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      })
  )
})
