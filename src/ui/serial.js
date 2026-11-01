// 序列埠監看視窗（USART3 / ST-LINK 虛擬 COM）
import { $, esc } from './dom.js';
import { UI } from './state.js';
import { runElapsed } from '../core/runtime.js';

/* ---- 序列埠 ---- */
export let serBuf = '', serLines = [], serDirty = false;
export const tstamp = () => { const t = runElapsed(); return (t / 1000).toFixed(3).padStart(8); };
export function serialOut(s){
  serBuf += s; let i;
  while ((i = serBuf.indexOf('\n')) >= 0){ pushLine(serBuf.slice(0, i).replace(/\r/g, ''), ''); serBuf = serBuf.slice(i + 1); }
  if (serBuf.length > 400){ pushLine(serBuf, ''); serBuf = ''; }
}
export function serialSys(s, cls){ if (serBuf){ pushLine(serBuf.replace(/\r/g, ''), ''); serBuf = ''; } pushLine('— ' + s + ' —', cls || 'sys'); }
export function pushLine(text, cls){
  serLines.push(`<span class="ts">[${tstamp()}]</span> ${cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text)}`);
  if (serLines.length > 400) serLines.splice(0, serLines.length - 400);
  if (UI.tab !== 'serial'){ UI.serialUnread++; $('#bSerial').hidden = false; $('#bSerial').textContent = UI.serialUnread > 99 ? '99+' : UI.serialUnread; }
  if (!serDirty){ serDirty = true; requestAnimationFrame(() => { serDirty = false; const el = $('#serial'), atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40; el.innerHTML = serLines.join('\n'); if (atEnd) el.scrollTop = el.scrollHeight; }); }
}
$('#btnSerClear').addEventListener('click', () => { serLines = []; serBuf = ''; $('#serial').innerHTML = ''; });
