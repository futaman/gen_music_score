// Service Worker：描画エンジン（WASM を含む大きな JS）と楽器サンプルをキャッシュして、2回目以降の起動を速くする。
// 名前にハッシュが付くファイル（assets/）とサンプル・アイコンは「キャッシュ優先」、ページ本体は「ネット優先」。
// オフライン対応は後回し（docs/spec.md）なので、ここではキャッシュの用途を起動の速さに絞る。

const CACHE = 'gen-music-score-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  const immutable = /\/assets\//.test(path) || /\/samples\//.test(path) || /\/icons\//.test(path);
  if (immutable) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  } else if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
    );
  }
});
