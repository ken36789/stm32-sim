// 使用統計（選用）：只有在 src/config.js 填了 GoatCounter 代碼、而且是正式網站時才會載入。
// GoatCounter 不用 cookie、不記錄 IP 或個資，只記錄頁面與事件次數（例如「開始第 1 關」「過關」）。
import { CONFIG } from '../config.js';

let on = false;
export function initAnalytics(){
  if (!CONFIG.goatcounter || location.protocol !== 'https:') return;
  const s = document.createElement('script');
  s.async = true; s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${CONFIG.goatcounter}.goatcounter.com/count`;
  document.head.appendChild(s); on = true;
}
/** 記錄一個事件（沒有啟用時什麼都不做） */
export function track(name){
  if (!on) return;
  const send = () => window.goatcounter?.count?.({ path:`event/${name}`, title:name, event:true });
  if (window.goatcounter?.count) send(); else setTimeout(send, 2500);
}
