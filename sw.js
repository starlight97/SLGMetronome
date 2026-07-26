/* SLGMetronome 서비스 워커 — 오프라인 캐시 (stale-while-revalidate)
   버전은 index.html의 APP_VER가 등록 URL 쿼리(?v=...)로 전달한다 — 이 파일은 배포 시 건드릴 필요 없음. */
const CACHE = 'slg-metronome-' + (new URL(self.location.href).searchParams.get('v') || 'v0');
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;   // 캐시 우선 응답 + 백그라운드 갱신
    })
  );
});
