// 作品（工作台）的存檔格式：開發板、模組與設定、杜邦線、程式碼。
// 本機存檔（localStorage）、分享網址、闖關都用同一種格式。分享網址用 deflate 壓縮後再轉成 base64url，放在 #p= 後面。
import { bench, wires, PINS, addModule, addWire, resetBench, setBoard, refreshNet } from './sim.js';
import { BOARD_BY_ID, DEFAULT_BOARD } from './boards.js';
import { MODULE_TYPES } from './parts.js';
import { isStepper, isDriver, motorOf, drvOf, setDiv, setLoad } from './steppers.js';

const COLORS = ['red', 'black', 'yellow', 'blue', 'green', 'orange', 'white', 'purple'];
/** 目前工作台 → 可存檔的物件 */
export function snapshot({ code, example } = {}){
  return {
    v:1, board:bench.board.id,
    modules:bench.modules.map(m => ({ id:m.id, type:m.type, variant:m.variant, slot:m.slot,
      ...(m.type === 'pot' ? { pot:Math.round(m.st.pot * 100) / 100 } : {}),
      ...(isStepper(m) ? { div:motorOf(m).jdiv, load:motorOf(m).load } : {}),
      ...(isDriver(m) ? { jdiv:drvOf(m).jdiv, vref:drvOf(m).vref } : {}),
      ...(m.type === 'psu' && m.st.on === false ? { on:false } : {}) })),
    wires:wires.map(w => [w.a, w.b, w.color]),
    ...(example ? { example:true } : typeof code === 'string' ? { code } : {}),
  };
}
/** 依存檔重建工作台（不含程式碼；程式碼由介面處理）。回傳實際使用的開發板 id */
export function loadBench(s){
  resetBench();
  const board = s && BOARD_BY_ID[s.board] ? s.board : DEFAULT_BOARD;
  setBoard(board, true);
  for (const x of (s && Array.isArray(s.modules) ? s.modules : [])){
    const m = MODULE_TYPES[x.type] && addModule(x.type, x.variant, true, x); if (!m) continue;
    if (m.type === 'pot' && typeof x.pot === 'number') m.st.pot = Math.max(0, Math.min(1, x.pot));
    if (m.type === 'stepper' && x.div) setDiv(m, x.div);
    if (isStepper(m) && x.load !== undefined) setLoad(m, x.load);
    if (isDriver(m)){ if (x.jdiv) drvOf(m).jdiv = x.jdiv; if (x.vref) drvOf(m).vref = x.vref; }
    if (m.type === 'psu' && x.on === false) m.st.on = false;
  }
  return board;
}
export function loadWires(s){
  for (const [a, b, c] of (s && Array.isArray(s.wires) ? s.wires : [])) if (PINS[a] && PINS[b]) addWire(a, b, COLORS.includes(c) ? c : null, true);
  refreshNet();
}

/* ---------- 分享網址 ---------- */
const b64url = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function pipe(bytes, Stream){ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer()); }
/** 物件 → 網址片段（'z' 開頭＝壓縮過；舊瀏覽器沒有 CompressionStream 時用 'j' 開頭的未壓縮格式） */
export async function encodeShare(state){
  const raw = new TextEncoder().encode(JSON.stringify(state));
  if (typeof CompressionStream === 'function'){ try { return 'z' + b64url(await pipe(raw, CompressionStream)); } catch (_){ /* 用未壓縮格式 */ } }
  return 'j' + b64url(raw);
}
export async function decodeShare(str){
  const kind = str[0], bytes = unb64url(str.slice(1));
  const raw = kind === 'z' ? await pipe(bytes, DecompressionStream) : bytes;
  const s = JSON.parse(new TextDecoder().decode(raw));
  if (!s || s.v !== 1 || typeof s.board !== 'string') throw new Error('不是這個模擬器的作品網址');
  return s;
}
