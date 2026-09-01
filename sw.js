// Offline service worker.
//
// Why this exists: a siddur is used in exactly the places phones lose signal —
// on a plane, underground, in a stairwell at work. Without this, tapping the
// home-screen icon offline gives a browser error page instead of the prayers.
//
// The three double-underscore placeholders in the CACHE, SHELL and PAGES
// assignments below are substituted by build/build.mjs::stampServiceWorker():
// a content hash of everything precached, the shell asset list, and every
// canonical page. Both lists are derived from what actually shipped, so they
// cannot drift from the manifest. The build asserts each token is present
// before substituting and absent after, so renaming one fails the build.
//
// Two tiers, deliberately:
//   SHELL  — small, precached for everyone on install. Enough to render any
//            page that is already cached.
//   PAGES  — the whole siddur, ~1 MB over the wire. Fetched ONLY when a client
//            asks via postMessage, which app.js does when the site is running
//            installed or the reader has just installed it. A first-time
//            visitor reading one prayer over metered cellular must not silently
//            pay for 64 pages they did not ask for.
//
// Every path is relative with NO leading slash. sw.js is served from the
// deploy root, so relative paths resolve correctly whether the site is at
// onlinesiddur.com/ or at a GitHub Pages project subpath. Same contract as
// static/fonts.css and the web manifest; see CLAUDE.md.

var CACHE = 'siddur-ac98474f1410';
var SHELL = ["./","offline.html","styles.css","fonts.css","app.js","calendar.js","favicon.svg","manifest.webmanifest","apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","fonts/inter-400.woff2","fonts/inter-500.woff2","fonts/eb-garamond-400.woff2","fonts/he-ruehl-400.woff2","fonts/he-ruehl-700.woff2"];
var PAGES = ["nusach/","about/","install/","shacharit/ashkenaz/","shacharit/sefard/","shacharit/ari/","shacharit/edut/","mincha/ashkenaz/","mincha/sefard/","mincha/ari/","mincha/edut/","maariv/ashkenaz/","maariv/sefard/","maariv/ari/","maariv/edut/","birkat/ashkenaz/","birkat/sefard/","birkat/ari/","birkat/edut/","bracha/ashkenaz/","bracha/sefard/","bracha/ari/","bracha/edut/","musaf/ashkenaz/","musaf/sefard/","musaf/ari/","musaf/edut/","kabbalat/ashkenaz/","kabbalat/sefard/","kabbalat/ari/","kabbalat/edut/","kadish/ashkenaz/","kadish/sefard/","kadish/ari/","kadish/edut/","derech/ashkenaz/","derech/sefard/","derech/ari/","derech/edut/","ksham/ashkenaz/","ksham/sefard/","ksham/ari/","ksham/edut/","levana/ashkenaz/","levana/sefard/","levana/ari/","levana/edut/","omer/ashkenaz/","omer/sefard/","omer/ari/","omer/edut/","chatzot/ashkenaz/","chatzot/sefard/","chatzot/ari/","chatzot/edut/","nerot/ashkenaz/","nerot/sefard/","nerot/ari/","nerot/edut/","klali/ashkenaz/","klali/sefard/","klali/ari/","klali/edut/","tehilim/"];
var HOME = './';
var OFFLINE = 'offline.html';

// How long a navigation waits for the network before falling back to cache.
// Without this, a stalled-but-connected link ("lie-fi" — TCP up, no
// throughput) never rejects and the reader stares at a blank screen for the
// browser's own multi-minute timeout while a complete copy sits in the cache.
var NET_TIMEOUT_MS = 3500;

// Individually and in small batches, never cache.addAll():
//   - addAll rejects atomically, so one 404 would leave the reader with no
//     worker at all rather than a nearly-complete cache
//   - firing 50+ requests at once is slower and more failure-prone on the weak
//     connection that makes offline support matter in the first place
// Resolves to the number of URLs that FAILED, so callers can decide whether a
// partial result is acceptable. Swallowing failures silently is what lets a
// half-filled cache masquerade as a working one.
function fill(cache, urls) {
  var failed = 0;
  var i = 0;
  function next() {
    if (i >= urls.length) return Promise.resolve(failed);
    var batch = urls.slice(i, i + 6);
    i += 6;
    return Promise.all(batch.map(function (url) {
      return cache.add(new Request(url, { cache: 'reload' }))
        .catch(function () { failed++; });
    })).then(next);
  }
  return next();
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return fill(cache, SHELL).then(function (failed) {
        // Reject rather than activate a broken worker. If the shell did not
        // land, activating would swap in a cache that cannot render a page AND
        // delete the previous one that could. Failing install leaves the old
        // worker and its complete cache in charge, and the browser retries.
        if (failed > 0) throw new Error('shell precache incomplete: ' + failed + ' failed');
        return self.skipWaiting();
      });
    }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // Scope the sweep to OUR caches. caches.keys() is per-ORIGIN, and
        // github.io hosts every project page of an account on one origin, so
        // an unfiltered delete would wipe unrelated apps' offline data.
        if (k.indexOf('siddur-') !== 0 || k === CACHE) return null;
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); }),
  );
});

// Full-siddur precache, on request. app.js posts this when the site is running
// installed, so the ~1 MB is charged to readers who opted in.
self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'precache-all') return;
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return fill(cache, PAGES);
    }).then(function (failed) {
      // Best-effort: a page that failed is simply refetched next time the
      // reader opens it online. Report back so the client can retry later.
      if (event.source) event.source.postMessage({ type: 'precache-done', failed: failed });
    }),
  );
});

// Only 200s are cacheable. `res.ok` is true for 206 Partial Content, which
// Cache.put rejects outright, and an opaque/redirected response would poison
// the entry. Anything else (404, 502, a captive portal's login page) must
// never overwrite a good precached prayer.
function cacheable(res) {
  return res && res.status === 200 && res.type !== 'opaque' && res.type !== 'opaqueredirect';
}

// Cache writes are extended-lifetime work: respondWith settles as soon as the
// response is returned, so without waitUntil the browser may kill the worker
// mid-put — on iOS especially, which terminates workers aggressively.
function put(event, req, res) {
  if (!cacheable(res)) return;
  var copy = res.clone();
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {}),
  );
}

// Query strings never change which document is served — this is a static site,
// and the only in-app query is the nusach picker's `?from=<prayer>`, which is
// read by app.js after the page loads. Matching with ignoreSearch is what lets
// the precached `nusach/` answer a request for `nusach/?from=shacharit`.
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  // Range requests must reach the network untouched: a cached full 200 would
  // be appended to bytes already on disk and corrupt a resumed download.
  if (req.headers.get('range')) return;

  // Pages: network first, with a timeout. The liturgy is the one thing that
  // must not be served stale — a correction to a prayer has to reach readers
  // on their next online visit, not their next cache eviction.
  if (req.mode === 'navigate') {
    event.respondWith(
      new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (!settled) { settled = true; reject(new Error('timeout')); }
        }, NET_TIMEOUT_MS);
        fetch(req).then(function (res) {
          clearTimeout(timer);
          if (settled) { put(event, req, res); return; } // too late to serve, still refresh
          settled = true;
          put(event, req, res);
          resolve(res);
        }, function (err) {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(err); }
        });
      }).catch(function () {
        return fromCache(req).then(function (hit) {
          if (hit) return hit;
          // Not the home page: index.html is depth-0, and its asset paths and
          // injected window.__BASE__ are './…', so serving it at /a/b/c/ points
          // every link and script into a subtree that does not exist. offline.html
          // is fully self-contained for exactly this reason.
          return caches.match(OFFLINE).then(function (off) {
            return off || new Response(
              '<!doctype html><meta charset="utf-8"><title>Offline</title><p>Offline.',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
          });
        });
      }),
    );
    return;
  }

  // Assets: cache first. These change only on deploy, and a deploy changes
  // the content hash in CACHE, which drops every old cache in activate above.
  event.respondWith(
    fromCache(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        put(event, req, res);
        return res;
      });
    }),
  );
});
