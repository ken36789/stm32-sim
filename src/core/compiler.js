// 簡化的 C/HAL 編譯器：檢查常見錯誤（gcc 格式），再轉譯成可逐步執行的 async JavaScript
import { API_NAMES, BUILTIN_FNS, VENDOR_PREFIX } from './hal.js';

/* ================= 編譯器（C/HAL → 模擬執行） ================= */
export const TYPES = 'void|int|char|short|long|float|double|bool|_Bool|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|HAL_StatusTypeDef|GPIO_PinState';
export const TYPESET = new Set(TYPES.split('|').concat(['unsigned', 'signed', 'static', 'const', 'volatile']));
export const ASYNC_BUILTIN = ['delay_cycles', '__delay_cycles', 'SysCtlDelay', 'DEVICE_DELAY_US', 'SDK_DelayAtLeastUs', 'HAL_Delay', 'HAL_I2C_Mem_Read', 'HAL_I2C_Mem_Write', 'HAL_I2C_Master_Transmit', 'HAL_I2C_Master_Receive', 'HAL_I2C_IsDeviceReady'];
const CAST_FN = { uint8_t:'__u8', int8_t:'__i8', char:'__i8', uint16_t:'__u16', int16_t:'__i16', short:'__i16', uint32_t:'__u32', int32_t:'__i32', int:'__i32', long:'__i32', size_t:'__u32', unsigned:'__u32' };
const CAST_RE = 'unsigned\\s+int|unsigned\\s+long|unsigned|signed\\s+int|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int32_t|int|long|short|char|size_t';
const castFn = t => CAST_FN[t.replace(/^signed\s+/, '').replace(/^unsigned\s+(int|long)$/, 'unsigned')] || '';
export const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export function stripCode(src, keepStrings){
  let out = '', i = 0; const n = src.length;
  while (i < n){
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/'){ while (i < n && src[i] !== '\n'){ out += ' '; i++; } }
    else if (c === '/' && d === '*'){ out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')){ out += src[i] === '\n' ? '\n' : ' '; i++; } if (i < n){ out += '  '; i += 2; } }
    else if (c === '"' || c === "'"){
      out += c; i++;
      while (i < n && src[i] !== c && src[i] !== '\n'){
        if (src[i] === '\\' && i + 1 < n){ out += keepStrings ? src[i] + src[i + 1] : '  '; i += 2; continue; }
        out += keepStrings ? src[i] : ' '; i++;
      }
      if (i < n && src[i] === c){ out += c; i++; }
    } else { out += c; i++; }
  }
  return out;
}
export function posOf(text, idx){ let line = 1, last = -1; for (let k = 0; k < idx; k++) if (text[k] === '\n'){ line++; last = k; } return { line, col: idx - last }; }

export function compile(src){
  const diag = [], bare = stripCode(src, false), noCom = stripCode(src, true);
  const D = (line, col, msg, sev = 'error') => diag.push({ sev, line, col, msg });
  const userFns = new Set(), protos = new Set(), macros = new Set(), macroFns = new Set(); let m;
  const fnRe = new RegExp(String.raw`(?:^|\n)[ \t]*(?:static\s+|inline\s+)*(?:${TYPES}|[a-z_]\w*_t)\s*\*?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([{;])`, 'g');
  while ((m = fnRe.exec(bare))) (m[3] === '{' ? userFns : protos).add(m[1]);
  bare.split('\n').forEach(l => { const d = l.match(/^\s*#\s*define\s+(\w+)(\()?/); if (d) (d[2] ? macroFns : macros).add(d[1]); });

  // 1. 括號配對
  const stack = [], pair = { ')':'(', '}':'{', ']':'[' };
  for (let i = 0; i < bare.length; i++){
    const ch = bare[i];
    if (ch === '(' || ch === '{' || ch === '[') stack.push({ ch, i });
    else if (pair[ch]){
      const top = stack.pop();
      if (!top || top.ch !== pair[ch]){ const p = posOf(bare, i); D(p.line, p.col, `expected expression before '${ch}' token`); break; }
    }
  }
  if (stack.length && !diag.length){ const lines = bare.split('\n').length; const t = stack[stack.length - 1]; const p = posOf(bare, t.i);
    D(lines, 1, t.ch === '{' ? `expected declaration or statement at end of input（第 ${p.line} 行的 '{' 沒有對應的 '}'）` : `expected '${t.ch === '(' ? ')' : ']'}' before end of input（第 ${p.line} 行）`); }

  // 2. 缺少分號
  const L = bare.split('\n'), header = new RegExp(String.raw`^(?:static\s+|inline\s+)*(?:${TYPES})\s*\*?\s+\w+\s*\(`);
  for (let i = 0; i < L.length; i++){
    const t = L[i].trim();
    if (!t || t.startsWith('#') || /[;{},:\\]$/.test(t)) continue;
    if (/^(?:\}\s*)?(if|else|for|while|do|switch|case|default)\b/.test(t) || header.test(t)) continue;
    if (/(\|\||&&|[-+*/%=<>!&|^?(,~])$/.test(t)) continue;
    let j = i + 1; while (j < L.length && !L[j].trim()) j++;
    const nt = j < L.length ? L[j].trim() : '';
    if (/^([{)\].?:+\-*/%&|^<>=]|\|\||&&)/.test(nt)) continue;
    if (/[\w)\]"']$/.test(t)){ const tok = (nt.match(/^[A-Za-z_]\w*|^\S/) || ['}'])[0]; D(i + 1, L[i].replace(/\s+$/, '').length + 1, `expected ';' before '${tok}'`); }
  }

  // 3. 未宣告的函式與識別字
  const KEYW = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'else', 'do', 'case']);
  const seen = new Set(), callRe = /\b([A-Za-z_]\w*)\s*\(/g;
  while ((m = callRe.exec(bare))){
    const n = m[1];
    if (KEYW.has(n) || TYPESET.has(n) || BUILTIN_FNS.has(n) || userFns.has(n) || macroFns.has(n) || macros.has(n)) continue;
    const p = posOf(bare, m.index), key = n + ':' + p.line; if (seen.has(key)) continue; seen.add(key);
    if (protos.has(n)) diag.push({ sev:'error', link:true, msg:`undefined reference to \`${n}'（只有宣告，沒有定義）` });
    else if (VENDOR_PREFIX.test(n)) D(p.line, p.col, `'${n}' 是 SDK 的設定函式，模擬器沒有實作，執行時會略過`, 'warning');
    else D(p.line, p.col, `implicit declaration of function '${n}'；模擬器不支援這個函式`);
  }
  const idRe = /\b(GPIO_PIN_(\d+)|GPIO([A-Z])\b|(?:hi2c|huart|hlpuart|hspi|htim|hadc)\d+)/g, known = new Set(API_NAMES);
  while ((m = idRe.exec(bare))){
    const bad = (m[2] && +m[2] > 15) || (m[3] && m[3] > 'K') || (/^h/.test(m[1]) && !known.has(m[1]));
    if (bad){ const p = posOf(bare, m.index); D(p.line, p.col, `'${m[1]}' undeclared (first use in this function)` + (/^h/.test(m[1]) ? '；模擬器支援 hi2c1–3、huart1–3、hlpuart1、hadc1' : '')); }
  }
  if (!userFns.has('main')) diag.push({ sev:'error', link:true, msg:"undefined reference to `main'" });
  if (/while\s*\(\s*1\s*\)/.test(bare) && !/HAL_Delay|HAL_GetTick|delay_cycles|SysCtlDelay|DEVICE_DELAY_US|SDK_DelayAtLeastUs/.test(bare)) diag.push({ sev:'warning', line:null, msg:'主迴圈沒有 HAL_Delay，序列埠輸出會非常密集' });

  if (diag.some(d => d.sev === 'error')) return { ok:false, diag };
  let js;
  try { js = transpile(noCom, userFns); new AsyncFunction(...API_NAMES, js); }
  catch (e){ diag.push({ sev:'error', line:null, msg:'無法解析的語法：' + e.message }); return { ok:false, diag }; }
  const text = 9800 + Math.round(bare.replace(/\s+/g, '').length * 2.6) + (/printf/.test(bare) ? 6140 : 0) + (/hi2c1/.test(bare) ? 3480 : 0);
  return { ok:true, diag, js, size:{ text, data:120, bss:1864 + (bare.match(/\[\s*\d+\s*\]/g) || []).reduce((s, x) => s + +x.replace(/\D/g, ''), 0) } };
}

export function cparams(p){
  p = p.trim(); if (!p || p === 'void') return '';
  return p.split(',').map(x => (x.replace(/\[.*?\]/g, '').match(/[A-Za-z_]\w*(?=\s*$)/) || ['_'])[0]).join(', ');
}
export function transpile(s, userFns){
  const strs = [];
  s = s.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, x => { strs.push(x); return `__S${strs.length - 1}__`; });
  s = s.replace(/^[ \t]*#[ \t]*include[^\n]*/gm, '');
  s = s.replace(/^[ \t]*#[ \t]*define[ \t]+(\w+)\(([^)]*)\)[ \t]+([^\n]+)/gm, 'const $1 = ($2) => ($3);');
  s = s.replace(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+([^\n]+)/gm, 'const $1 = $2;');
  s = s.replace(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]*$/gm, 'const $1 = 1;');
  s = s.replace(/^[ \t]*#[^\n]*/gm, '');
  s = s.replace(new RegExp(String.raw`(^|\n)[ \t]*(?:static\s+|inline\s+)*(?:${TYPES}|[a-z_]\w*_t)\s*\*?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*;`, 'g'), '$1');
  s = s.replace(new RegExp(String.raw`\b(?:static\s+|inline\s+)*(?:${TYPES}|[a-z_]\w*_t)\s*\*?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(\s*)\{`, 'g'), (x, name, params, ws) => `async function ${name}(${cparams(params)})${ws}{`);
  s = s.replace(new RegExp(String.raw`\b(?:static\s+|volatile\s+|const\s+)*(?:unsigned\s+|signed\s+)?(?:${TYPES})\s+([A-Za-z_]\w*)\s*\[\s*([^\]]*)\]\s*(?:=\s*(\{[^}]*\}|__S\d+__))?\s*;`, 'g'),
    (x, name, size, init) => `let ${name} = __arr(${size || 0}, ${init ? (init[0] === '{' ? '[' + init.slice(1, -1) + ']' : init) : 'null'});`);
  s = s.replace(new RegExp(String.raw`\b(?:static\s+|volatile\s+|const\s+|register\s+)*(?:unsigned\s+|signed\s+)?(?:${TYPES})(?:\s*\*\s*|\s+)(?=[A-Za-z_])`, 'g'), 'let ');
  // 結構與 SDK 型別（xxx_t、I2C_Transaction 這類）：沒有初值時建立空物件；大括號初值改成陣列
  s = s.replace(/\b(?:static\s+|volatile\s+|const\s+)*(?:[a-z_][a-z0-9_]*_t|(?=[A-Z][A-Za-z0-9_]*[a-z])[A-Z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\s+([A-Za-z_]\w*)\s*;/g, 'let $1 = {};');
  s = s.replace(/\b(?:static\s+|volatile\s+|const\s+)*(?:[a-z_][a-z0-9_]*_t|(?=[A-Z][A-Za-z0-9_]*[a-z])[A-Z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\s+(?=[A-Za-z_]\w*\s*=)/g, 'let ');
  s = s.replace(/=\s*\{([^{}]*)\}\s*;/g, '= [$1];');
  s = s.replace(/\blet\s+([A-Za-z_]\w*)\s*;/g, 'let $1 = 0;');
  // 整數型別轉換保留截斷效果：(int16_t)(x) → __i16(x)、(uint8_t)a[i] → __u8(a[i])；其他轉換（float、指標）直接移除
  s = s.replace(new RegExp(String.raw`\(\s*(?:const\s+)?(${CAST_RE})\s*\)\s*(?=\()`, 'g'), (x, t) => castFn(t) || x);
  s = s.replace(new RegExp(String.raw`\(\s*(?:const\s+)?(${CAST_RE})\s*\)\s*([A-Za-z_]\w*(?:\s*\[[^\]]*\])*)(?!\s*[\w(])`, 'g'), (x, t, e) => castFn(t) ? `${castFn(t)}(${e})` : x);
  s = s.replace(new RegExp(String.raw`\(\s*(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:${TYPES})\s*\**\s*\)`, 'g'), '');
  s = s.replace(/\b(0[xX][0-9a-fA-F]+|\d+)[uUlL]+\b/g, '$1');
  s = s.replace(/\b(\d+\.\d*|\d+\.?\d*[eE][-+]?\d+)[fF]\b/g, '$1');
  s = s.replace(/([(,=]\s*)&(?=\s*[A-Za-z_])/g, '$1');
  s = s.replace(/->/g, '.');
  const asy = [...ASYNC_BUILTIN, ...[...userFns].filter(n => n !== 'main')];
  // 不用 lookbehind，舊版 Safari（iOS 16.3 以前）不支援
  s = s.replace(new RegExp(String.raw`\b(${asy.join('|')})\s*\(`, 'g'), (x, name, off, str) => (/[.$]/.test(str[off - 1] || '') || /function\s+$/.test(str.slice(Math.max(0, off - 12), off))) ? x : `await ${name}(`);
  s = insertYields(s);
  s = s.replace(/__S(\d+)__/g, (x, i) => strs[+i]);
  return 'with (__env) {\n' + s + '\n;return await main();\n}';
}
export function insertYields(s){
  const re = /\b(while|for)\s*\(|\bdo\s*\{/g; let out = '', last = 0, m;
  while ((m = re.exec(s))){
    if (m[0].startsWith('do')){ const e = m.index + m[0].length; out += s.slice(last, e) + ' await __y();'; last = e; continue; }
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < s.length; j++){ if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
    let k = j + 1; while (k < s.length && /\s/.test(s[k])) k++;
    if (s[k] === '{'){ out += s.slice(last, k + 1) + ' await __y();'; last = k + 1; re.lastIndex = k + 1; }
    else if (s[k] === ';'){
      if (m[1] === 'while' && s.slice(0, m.index).trimEnd().endsWith('}')) { re.lastIndex = k + 1; continue; }
      out += s.slice(last, k) + '{ await __y(); }'; last = k + 1; re.lastIndex = k + 1;
    } else {
      let e = s.indexOf(';', k); if (e < 0) e = s.length - 1;
      out += s.slice(last, k) + '{ await __y(); ' + s.slice(k, e + 1) + ' }'; last = e + 1; re.lastIndex = e + 1;
    }
  }
  return out + s.slice(last);
}
