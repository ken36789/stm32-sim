// 離線使用：第一次打開後，網頁、程式與字型都會存在裝置上，沒有網路（例如教室 Wi-Fi 不穩）也能開。
// 網頁本身採「先上網、失敗才用快取」，所以有網路時一定拿到最新版；其他檔案先用快取、背景更新。
const CACHE = 'mcu-lab-v0.7.1';
const CORE = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url), same = url.origin === location.origin, font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (req.mode === 'navigate'){
    // 網頁一律向伺服器確認最新版（不用瀏覽器的 10 分鐘快取），避免網站剛更新時拿到舊網頁、找不到新的程式檔
    e.respondWith(fetch(req.url, { cache:'no-cache', credentials:'same-origin' }).then(r => {
      if (r.redirected) return Response.redirect(r.url, 302);           // Safari 不接受 service worker 回傳「轉址過的」網頁
      if (r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {}); }
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  if (!same && !font) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
