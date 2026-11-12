// Lets ArcMe open with no signal.
//
// Her page already lives on her phone (data/store.js); what didn't was the app
// itself, so with no signal the icon on her home screen opened to "Safari
// cannot open the page". This keeps a copy of what the app is made of as it's
// used, and hands it back when the network can't.
//
//   the page itself      network first (a few seconds), the kept copy if not —
//                        so a new version always arrives when there's signal
//   version.json         never kept: it's how the app learns there's an update
//   app files (assets/)  kept copy first: they're named by their contents, so a
//                        new version brings new names rather than stale files
//   pictures, fonts      the kept copy now, and a fresh one fetched behind it
//                        for next time — her page art keeps its name when it's
//                        redrawn, so it mustn't be kept forever
//
// Anything else (Apple Music, the cloud, the AI helper) goes straight through.

const CACHE = 'arcme-v1'
const KEEP = 220 // files kept; the oldest go first

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

const scope = new URL(self.registration.scope)
const sameOrigin = (url) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
const fonts = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'

async function keep(req, res) {
  if (!res || !(res.ok || res.type === 'opaque')) return
  const c = await caches.open(CACHE)
  await c.put(req, res)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - KEEP; i++) await c.delete(keys[i])
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // the page: fresh when it can be, the kept one when it can't
  if (req.mode === 'navigate' && sameOrigin(url)) {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000)),
        ])
        e.waitUntil(keep(scope.href, res.clone()))
        return res
      } catch {
        return (await caches.match(scope.href)) || (await caches.match(req)) || Response.error()
      }
    })())
    return
  }

  if (sameOrigin(url) && /\/(version|music-token)\.json$/.test(url.pathname)) return

  if (sameOrigin(url) && url.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const kept = await caches.match(req)
      if (kept) return kept
      const res = await fetch(req)
      e.waitUntil(keep(req, res.clone()))
      return res
    })())
    return
  }

  if (sameOrigin(url) || fonts(url)) {
    e.respondWith((async () => {
      const kept = await caches.match(req)
      const fresh = fetch(req).then((res) => { keep(req, res.clone()); return res })
      if (kept) { e.waitUntil(fresh.catch(() => {})); return kept }
      return fresh
    })())
  }
})
