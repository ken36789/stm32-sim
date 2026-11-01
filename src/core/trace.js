// 邏輯訊號記錄（微秒時間軸）：GPIO 輸出與 I2C、UART、SPI、CAN 匯流排上的電位變化，給邏輯分析儀擷取。
// 每條線以「來源」為鍵：MCU 腳位名稱（PB8、P1.3、PTE24…），CAN 匯流排本身用 'CAN.BUS'（0 = 顯性）。
// 只有工作台上有分析儀時才記錄（TRACE.on），不影響一般模擬的效能。
import { canFrameBits } from './protocols.js';

export const TRACE = { on:false, cursor:0, lines:new Map(), keep:12e6, n:0 };
const nowUs = () => performance.now() * 1000;
/** 目前的訊號時間：實際時間，或上一段傳輸結束的時間（傳輸需要時間，後面的事件不能和它重疊） */
export const tNow = () => Math.max(nowUs(), TRACE.cursor);
export function setTrace(on){ if (on && !TRACE.on) TRACE.cursor = nowUs(); TRACE.on = !!on; if (!on) TRACE.lines.clear(); }

function line(key, idle){ let L = TRACE.lines.get(key); if (!L){ L = { init:idle, t:[], v:[] }; TRACE.lines.set(key, L); } return L; }
export function edge(key, t, v, idle = 1){
  if (!key) return;
  const L = line(key, idle), n = L.v.length, cur = n ? L.v[n - 1] : L.init;
  if (cur === v) return;
  if (n && t - L.t[n - 1] < .02){
    // 比 20 ns 還短的脈衝在這個模擬裡沒有物理意義（同一時間的兩個事件），直接合併
    const tl = L.t.pop(); L.v.pop();
    if ((L.v.length ? L.v[L.v.length - 1] : L.init) !== v){ L.t.push(tl); L.v.push(v); }
    return;
  }
  L.t.push(t); L.v.push(v);
  if (++TRACE.n % 4096 === 0) prune();
}
function prune(){
  const lim = tNow() - TRACE.keep;
  for (const L of TRACE.lines.values()){ let k = 0; while (k < L.t.length && L.t[k] < lim) k++; if (k){ L.init = L.v[k - 1]; L.t.splice(0, k); L.v.splice(0, k); } }
}
/** 預留一段傳輸時間，回傳開始時間 */
export function reserve(dur, gap = 3){ const t0 = tNow() + gap; TRACE.cursor = t0 + dur; return t0; }
/** 最後一次變化的時間（給 3D 分析儀的活動指示燈） */
export function lastActivity(key){ const L = TRACE.lines.get(key); return L && L.t.length ? L.t[L.t.length - 1] : -Infinity; }
/** 取出 [t0, t1] 這段時間的訊號；沒有紀錄時用 idle 電位 */
export function snapshot(key, t0, t1, idle = 1){
  const L = TRACE.lines.get(key);
  if (!L) return { init:idle, t:[], v:[] };
  let i = 0; while (i < L.t.length && L.t[i] <= t0) i++;
  const init = i ? L.v[i - 1] : L.init, t = [], v = [];
  for (; i < L.t.length && L.t[i] <= t1; i++){ t.push(L.t[i]); v.push(L.v[i]); }
  return { init, t, v };
}

/* ---------- GPIO ---------- */
export function traceGpio(pin, v){
  if (!TRACE.on) return;
  if (!TRACE.lines.has(pin)){ line(pin, v ? 1 : 0); return; }
  edge(pin, tNow(), v ? 1 : 0, 0);
}

/* ---------- I2C（100 kHz）：segs = [{ addr, read, bytes, nak }]，多段之間用重複起始連接 ---------- */
export function traceI2C(scl, sda, segs, hz = 100e3){
  if (!TRACE.on || !scl || !sda) return;
  const T = 1e6 / hz, q = T / 4;
  let nb = 0; for (const s of segs){ nb += 1 + (s.nak ? 0 : s.bytes.length); if (s.nak) break; }
  let t = reserve(T * (nb * 9 + segs.length + 2));
  edge(sda, t, 0); t += 2 * q; edge(scl, t, 0);                       // START：SCL 高電位時，SDA 由高變低
  const bit = b => { edge(sda, t + q, b); edge(scl, t + 2 * q, 1); edge(scl, t + 4 * q, 0); t += T; };
  const byte = (x, ack) => { for (let k = 7; k >= 0; k--) bit((x >> k) & 1); bit(ack); };
  for (let i = 0; i < segs.length; i++){
    const s = segs[i];
    if (i){ edge(sda, t + q, 1); edge(scl, t + 2 * q, 1); edge(sda, t + 3 * q, 0); edge(scl, t + 4 * q, 0); t += T; }   // 重複起始
    byte((s.addr << 1) | (s.read ? 1 : 0), s.nak ? 1 : 0);
    if (s.nak) break;
    s.bytes.forEach((x, k) => byte(x & 0xFF, s.read ? (k === s.bytes.length - 1 ? 1 : 0) : 0));
  }
  edge(sda, t + q, 0); edge(scl, t + 2 * q, 1); edge(sda, t + 3 * q, 1);   // STOP：SCL 高電位時，SDA 由低變高
  TRACE.cursor = Math.max(TRACE.cursor, t + 4 * q);
}

/* ---------- UART（8N1，LSB 先送） ---------- */
export function traceUART(tx, bytes, baud = 115200){
  if (!TRACE.on || !tx || !bytes.length) return;
  const T = 1e6 / baud; let t = reserve(bytes.length * 10 * T);
  for (const b of bytes){
    edge(tx, t, 0);
    for (let k = 0; k < 8; k++) edge(tx, t + (k + 1) * T, (b >> k) & 1);
    edge(tx, t + 9 * T, 1); t += 10 * T;
  }
}
export const utf8 = s => Array.from(new TextEncoder().encode(String(s)));

/* ---------- SPI（模式 0、MSB 先送、1 MHz）；CS 由 GPIO 控制，另外記錄 ---------- */
export function traceSPI(p, tx, rx, hz = 1e6){
  if (!TRACE.on || !p.sck) return;
  const T = 1e6 / hz; let t = reserve(tx.length * 9 * T, 2);
  for (let i = 0; i < tx.length; i++){
    for (let k = 7; k >= 0; k--){
      edge(p.mosi, t, (tx[i] >> k) & 1, 0); edge(p.miso, t, (rx[i] >> k) & 1, 1);
      edge(p.sck, t + T / 2, 1, 0); edge(p.sck, t + T, 0, 0); t += T;
    }
    t += T;                                                                // 位元組之間的間隔
  }
}

/* ---------- CAN（500 kbps）：keys = { tx, rx, bus }；from 'mcu' 或 'node' ---------- */
export function traceCAN(keys, id, data, o = {}){
  if (!TRACE.on) return;
  const T = 1e6 / (o.bitrate || 500e3), fr = canFrameBits(id, data);
  let t = reserve((fr.length + 3 + (o.ack ? 0 : 6)) * T, 4);
  for (const x of fr){
    if (!o.ack && x.f === 'ackdel'){
      // 沒有任何節點確認（ACK 錯誤）：傳送端從下一個位元開始送出錯誤旗標（6 個顯性位元），再送 8 個隱性的錯誤分隔位元
      for (const k of [keys.bus, keys.rx, ...(o.from === 'mcu' ? [keys.tx] : [])]){ edge(k, t, 0); edge(k, t + 6 * T, 1); }
      break;
    }
    const busBit = x.f === 'ack' ? (o.ack ? 0 : 1) : x.b;
    const txBit = o.from === 'mcu' ? x.b : (x.f === 'ack' && o.mcuAck ? 0 : 1);
    edge(keys.bus, t, busBit); edge(keys.rx, t, busBit); edge(keys.tx, t, txBit);
    t += T;
  }
}
