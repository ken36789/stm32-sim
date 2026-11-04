// 停用離線快取：iPhone Safari 上，service worker 接手網頁請求時會讓網站打不開（「網路連線中斷」）。
// 這個版本的唯一工作是：清掉之前存的快取、把自己註銷，再重新載入已開啟的頁面。之後所有請求都直接走網路。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (_){ /* 沒有快取 */ }
    try { await self.registration.unregister(); } catch (_){ /* 已經註銷 */ }
    try { const cs = await self.clients.matchAll({ type:'window' }); cs.forEach(c => { try { c.navigate(c.url); } catch (_){ /* 不能重新載入就算了 */ } }); } catch (_){ /* 沒有分頁 */ }
  })());
});
// 刻意不處理 fetch：所有請求都直接走網路
