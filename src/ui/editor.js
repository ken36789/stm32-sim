// main.c 編輯器：語法上色、行號、錯誤行標記、建置輸出
import { $, esc } from './dom.js';

export const editorEvents = { change(){}, save(){} };
/* ---- 編輯器 ---- */
export const ta = $('#code');
export function highlight(src){
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[ \t]*\w+)|\b(0[xX][0-9a-fA-F]+[uUlL]*|\d+\.?\d*[fFuUlL]*)\b|\b(if|else|while|for|do|return|break|continue|switch|case|default|static|volatile|const|void|int|char|short|long|float|double|unsigned|signed|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|bool|true|false|HAL_StatusTypeDef|GPIO_PinState)\b|\b([A-Za-z_]\w*)(?=\s*\()|\b([A-Z][A-Z0-9_]{2,}|hi2c1|huart3)\b/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(src))){
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'pre' : m[4] ? 'num' : m[5] ? 'kw' : m[6] ? 'fn' : 'mac';
    out += `<span class="c-${cls}">${esc(m[0])}</span>`; last = m.index + m[0].length;
  }
  return out + esc(src.slice(last)) + '\n ';
}
export let errLineSet = new Set();
export function syncEditor(){
  const v = ta.value; $('#hl').innerHTML = highlight(v);
  const n = v.split('\n').length; let g = ''; for (let i = 1; i <= n; i++) g += errLineSet.has(i) ? `<span class="e">${i}</span>\n` : i + '\n';
  $('#gutter').innerHTML = g; syncScroll();
}
export function syncScroll(){ const pre = $('#hl').parentElement; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; $('#gutter').scrollTop = ta.scrollTop; }
export function markGutter(set){ errLineSet = set; syncEditor(); }
export function codeValue(){ return ta.value; }
ta.addEventListener('input', () => { errLineSet = new Set(); syncEditor(); editorEvents.change(); });
ta.addEventListener('scroll', syncScroll);
ta.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey){ e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
  else if (e.key === 'Enter'){ const s = ta.selectionStart, ls = ta.value.lastIndexOf('\n', s - 1) + 1, ind = (ta.value.slice(ls, s).match(/^[ \t]*/) || [''])[0] + (/\{\s*$/.test(ta.value.slice(ls, s)) ? '  ' : ''); e.preventDefault(); ta.setRangeText('\n' + ind, s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 's'){ e.preventDefault(); editorEvents.save(); }
});
export function logClear(){ $('#log').innerHTML = ''; }
export function log(s, cls){ const el = $('#log'); el.insertAdjacentHTML('beforeend', `<span class="${cls || ''}">${esc(s)}</span>\n`); el.scrollTop = el.scrollHeight; }
