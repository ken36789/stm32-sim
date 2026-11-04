// 邏輯分析儀視窗：擷取、波形（觸控平移／縮放）、點選解說、分步教學與解碼清單
import { $, esc, toast } from './dom.js';
import { MODULE_TYPES, variantOf } from '../core/parts.js';
import { moduleById, moduleLabel, bench } from '../core/sim.js';
import { tNow } from '../core/trace.js';
import { hooks } from '../core/hooks.js';
import { capture, analyze, RATES, BAUDS, CAN_RATES } from '../core/analyzer.js';
import { explain, LESSONS } from '../core/lessons.js';
import { levelAt, idxAfter } from '../core/protocols.js';

const S = { id:null, cap:null, res:null, opt:{}, span:1, a:0, b:1, sel:null, tab:'info', step:0, busy:null, raf:0, lanes:[], rows:{} };
const PROTO_NAME = { i2c:'I2C', uart:'UART', spi:'SPI', can:'CAN' };
const SETTINGS = {};   // 每台分析儀自己的設定（關閉視窗後保留）

/* ---------- 顏色（跟著主題） ---------- */
let C = {};
function colors(){
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  C = { bg:v('--term-bg'), fg:v('--term-fg'), dim:v('--term-dim'), grid:'rgba(255,255,255,.07)', lbl:'rgba(255,255,255,.55)',
    sig:'#5fe08a', sig2:'#7fc2f2', h:'#ff9f43', l:'#5aa8ff', sel:'rgba(255,214,102,.18)', selLine:'#ffd666',
    k:{ start:'#3ddc84', rstart:'#3ddc84', stop:'#ff8f8f', addr:'#ffd166', data:'#7fc2f2', ack:'#5fe0c0', nack:'#ff6d76', bit:'#4a5964', packet:'#c79bf2', err:'#ff6d76',
      ustart:'#3ddc84', ubit:'#4a5964', upar:'#ffd166', ustop:'#ff8f8f', uferr:'#ff6d76', ubyte:'#7fc2f2', uerr:'#ff6d76', utext:'#c79bf2', utextbad:'#ff6d76',
      sbit:'#4a5964', smosi:'#ffd166', smiso:'#7fc2f2', sframe:'#c79bf2', sempty:'#93a2ac', serr:'#ff6d76',
      cbit:'#4a5964', cstuff:'#b07cf0', csof:'#3ddc84', cid:'#ffd166', crtr:'#93a2ac', cide:'#93a2ac', cr0:'#93a2ac', cdlc:'#f2a66b', cdata:'#7fc2f2', ccrc:'#5fe0c0', ccrcdel:'#93a2ac',
      cack:'#3ddc84', cnack:'#ff6d76', cackdel:'#93a2ac', ceof:'#93a2ac', cerrflag:'#ff6d76', cframe:'#c79bf2', cframenack:'#ff6d76', ccrcerr:'#ff6d76', cstufferr:'#ff6d76', cerr:'#ff6d76' } };
}

/* ---------- 版面：每種協定的通道與解碼列 ---------- */
function lanesFor(proto){
  const sig = (ch, label) => ({ t:'sig', ch, label: label || ch, h:34 }), ann = (row, label) => ({ t:'ann', row, label, h:20 });
  if (proto === 'i2c') return [sig('SCL'), sig('SDA'), ann('bits', '位元'), ann('fields', '欄位'), ann('packets', '傳輸')];
  if (proto === 'uart') return [sig('TX'), ann('TX.bits', '位元'), ann('TX.bytes', '位元組'), ann('TX.packets', '文字'), sig('RX'), ann('RX.bits', '位元'), ann('RX.bytes', '位元組'), ann('RX.packets', '文字')];
  if (proto === 'spi') return [sig('CS'), sig('SCK'), ann('bits', '位元'), sig('MOSI'), ann('mosi', 'MOSI'), sig('MISO'), ann('miso', 'MISO'), ann('packets', '傳輸')];
  return [{ t:'can', label:'CANH\nCANL', h:64 }, ann('bits', '位元'), ann('fields', '欄位'), ann('packets', '訊框')];
}

/* ---------- 開啟／關閉 ---------- */
export function openAnalyzer(id){
  const m = moduleById(id); if (!m) return;
  const T = MODULE_TYPES[m.type], v = variantOf(m.type, m.variant), proto = T.analyzer;
  if (S.id !== id){ S.cap = null; S.res = null; S.rows = {}; S.sel = null; S.step = 0; }
  S.id = id;
  const st = SETTINGS[id] || (SETTINGS[id] = { rate:Math.min(v.rate, 24e6), baud:115200, cpol:0, cpha:0, bitrate:500e3, span:2 });
  st.rate = Math.min(st.rate, v.rate);
  S.opt = st; S.span = st.span; S.lanes = lanesFor(proto);
  $('#laTitle').textContent = `${moduleLabel(m)}（${PROTO_NAME[proto]}）`;
  $('#laSub').textContent = `${v.name} · ${v.part}`;
  renderBar(m, v, proto);
  $('#la').hidden = false; document.body.classList.add('la-open');
  colors(); resize();
  if (!S.cap) startCapture(); else { renderPane(); draw(); }
}
export function closeAnalyzer(){ $('#la').hidden = true; document.body.classList.remove('la-open'); if (S.busy){ cancelAnimationFrame(S.raf); S.busy = null; } }
export const analyzerOpenFor = () => $('#la').hidden ? null : S.id;

/* ---------- 工具列 ---------- */
const fmtRate = r => r >= 1e6 ? `${+(r / 1e6).toFixed(2)} MS/s` : `${+(r / 1e3).toFixed(0)} kS/s`;
function renderBar(m, v, proto){
  const o = S.opt, opt = (vals, cur, fmt) => vals.map(x => `<option value="${x}" ${x == cur ? 'selected' : ''}>${esc(fmt(x))}</option>`).join('');
  let extra = '';
  if (proto === 'uart') extra = `<label>鮑率<select id="laBaud">${opt(BAUDS, o.baud, x => `${x} bps`)}</select></label>`;
  if (proto === 'spi') extra = `<label>模式<select id="laMode">${opt([0, 1, 2, 3], o.cpol * 2 + o.cpha, x => `模式 ${x}（CPOL ${x >> 1}、CPHA ${x & 1}）`)}</select></label>`;
  if (proto === 'can') extra = `<label>鮑率<select id="laCanRate">${opt(CAN_RATES, o.bitrate, x => `${x / 1000} kbps`)}</select></label>`;
  $('#laBar').innerHTML = `<button class="btn sm primary" id="laCap" type="button">擷取</button>
    <label>時間<select id="laSpan">${opt([0.2, 0.5, 1, 2, 5], S.span, x => `${x} 秒`)}</select></label>
    <label>取樣率<select id="laRate">${opt(RATES.filter(r => r <= v.rate), o.rate, fmtRate)}</select></label>${extra}
    <span class="la-zoom"><button class="btn sm" id="laZo" type="button" aria-label="縮小">－</button><button class="btn sm" id="laZi" type="button" aria-label="放大">＋</button><button class="btn sm" id="laFit" type="button">全部</button></span>`;
}

/* ---------- 擷取 ---------- */
/** 擷取：先錄 span 秒；這段時間探棒上完全沒有變化時，像分析儀的「觸發」一樣繼續等（最多 10 秒），等到訊號出現 */
function startCapture(){
  const m = moduleById(S.id); if (!m) return;
  if (S.busy) return;
  const span = S.span * 1e6, t0 = tNow();
  S.busy = { t0, end:t0 + span, waited:0 };
  $('#laMsg').hidden = false; renderPane();
  const quiet = cap => !cap.chans.some(c => c.src.kind === 'line' && c.sig && c.sig.t.length);
  const step = () => {
    if (!S.busy) return;
    const now = tNow(), p = Math.min(1, (now - S.busy.t0) / span);
    $('#laMsg').innerHTML = S.busy.waited ? `<b>等待訊號（觸發）…</b><span>已等 ${(S.busy.waited + (now - S.busy.t0)) / 1e6 | 0} 秒，探棒上還沒有變化</span><i style="width:${p * 100}%"></i>`
      : `<b>擷取中… ${Math.round(p * 100)}%</b><span>${(Math.min(now - S.busy.t0, span) / 1e6).toFixed(1)} / ${S.span} 秒</span><i style="width:${p * 100}%"></i>`;
    if (now >= S.busy.end){
      const cap = capture(m, S.busy.t0, S.busy.end);
      if (quiet(cap) && S.busy.waited + span < 10e6){ S.busy.waited += span; S.busy.t0 = S.busy.end; S.busy.end += span; S.raf = requestAnimationFrame(step); return; }
      S.busy = null; $('#laMsg').hidden = true;
      S.cap = cap; S.sel = null;
      reanalyze(true);
      return;
    }
    S.raf = requestAnimationFrame(step);
  };
  step();
}
function reanalyze(fit){
  if (!S.cap) return;
  S.res = analyze(S.cap, S.opt);
  { const m = moduleById(S.id); if (m) hooks.analyzed({ m, proto:MODULE_TYPES[m.type].analyzer, opt:S.opt, res:S.res }); }
  S.rows = {};
  for (const a of S.res.anns) (S.rows[a.row] = S.rows[a.row] || []).push(a);
  for (const r of Object.values(S.rows)) r.sort((x, y) => x.t0 - y.t0);
  if (fit) autoZoom();
  if (S.sel && !S.res.anns.includes(S.sel)) S.sel = null;
  renderPane(); resize();
}
/** 擷取完自動放大到第一筆解碼的資料 */
function autoZoom(){
  const pk = S.res.anns.filter(a => /packets$/.test(a.row)).sort((x, y) => x.t0 - y.t0)[0];
  if (pk) zoomTo(pk.t0, pk.t1, .15); else { S.a = S.cap.t0; S.b = S.cap.t1; }
}
function zoomTo(t0, t1, pad = .2){ const w = Math.max(t1 - t0, 2), p = w * pad; S.a = t0 - p; S.b = t1 + p; clampView(); }
function clampView(){
  if (!S.cap) return;
  const min = 0.5, max = S.cap.t1 - S.cap.t0;
  let w = S.b - S.a; w = Math.max(min, Math.min(max, w));
  let a = S.a; if (a < S.cap.t0) a = S.cap.t0; if (a + w > S.cap.t1) a = S.cap.t1 - w;
  S.a = a; S.b = a + w;
}

/* ---------- 畫波形 ---------- */
const LBL = 70, RULER = 24;
let cv, ctx, W = 0, H = 0;
function resize(){
  cv = $('#laCv'); if (!cv) return;
  const box = cv.parentElement, dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = box.clientWidth;
  // 訊號列依視窗高度放大（最多 1.8 倍），解碼列維持固定高度
  for (const l of S.lanes){ l.h0 = l.h0 || l.h; l.hide = l.t === 'ann' && !!S.res && !(S.rows[l.row] || []).length; }
  const shown = S.lanes.filter(l => !l.hide), base = shown.reduce((n, l) => n + l.h0 + 6, 0), sig = shown.filter(l => l.t !== 'ann').reduce((n, l) => n + l.h0, 0);
  const k = Math.max(1, Math.min(1.8, 1 + (box.clientHeight - RULER - 8 - base) / Math.max(1, sig)));
  for (const l of S.lanes){ l.h0 = l.h0 || l.h; l.hide = l.t === 'ann' && !!S.res && !(S.rows[l.row] || []).length; l.h = l.hide ? 0 : l.t === 'ann' ? l.h0 + (k > 1.2 ? 2 : 0) : Math.round(l.h0 * k); }
  const need = RULER + S.lanes.reduce((n, l) => n + (l.hide ? 0 : l.h + 6), 0) + 8;
  H = Math.max(box.clientHeight, need);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
const X = t => LBL + (t - S.a) / (S.b - S.a) * (W - LBL - 8);
const T = x => S.a + (x - LBL) / (W - LBL - 8) * (S.b - S.a);
function niceStep(span, px){ const raw = span / Math.max(2, px / 125), p = 10 ** Math.floor(Math.log10(raw)), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
export const fmtT = t => { const a = Math.abs(t); return a >= 1e6 ? `${(t / 1e6).toFixed(3)} s` : a >= 1e3 ? `${(t / 1e3).toFixed(a >= 1e5 ? 1 : 3)} ms` : `${t.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)} µs`; };
/** 時間軸刻度：單位依時間大小，小數位數依刻度間距（放大時才看得出差別） */
const fmtTick = (t, step) => { const a = Math.abs(t), [k, u] = a >= 1e6 ? [1e6, 's'] : a >= 1e3 ? [1e3, 'ms'] : [1, 'µs']; const d = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step / k) - 1e-9))); return `${(t / k).toFixed(d)} ${u}`; };
function draw(){
  if (!ctx || $('#la').hidden) return;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  if (!S.cap){ ctx.fillStyle = C.dim; ctx.font = '13px "Noto Sans TC", sans-serif'; ctx.fillText('按「擷取」開始量測。', LBL, RULER + 30); return; }
  // 時間軸
  const step = niceStep(S.b - S.a, W - LBL), first = Math.ceil((S.a - S.cap.t0) / step) * step;
  ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
  for (let t = first; S.cap.t0 + t <= S.b; t += step){
    const x = X(S.cap.t0 + t); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, RULER); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.fillText(fmtTick(t, step), x + 3, RULER / 2);
  }
  // 選取範圍
  if (S.sel){ const x0 = X(S.sel.t0), x1 = Math.max(X(S.sel.t1), x0 + 2); ctx.fillStyle = C.sel; ctx.fillRect(x0, RULER, x1 - x0, H - RULER); ctx.strokeStyle = C.selLine; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, RULER + .5, x1 - x0 - 1, H - RULER - 1); }
  let y = RULER + 4;
  for (const L of S.lanes){
    if (L.hide){ L.y = -999; continue; }
    ctx.fillStyle = C.lbl; ctx.font = L.t === 'ann' ? '11px "Noto Sans TC", sans-serif' : '600 12px "JetBrains Mono", monospace';
    L.label.split('\n').forEach((s, i, arr) => ctx.fillText(s, 8, y + L.h / 2 + (i - (arr.length - 1) / 2) * 15));
    L.y = y;
    if (L.t === 'sig') drawSig(L, y);
    else if (L.t === 'can') drawCan(L, y);
    else drawAnns(L, y);
    y += L.h + 6;
  }
  ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(LBL - 6, RULER); ctx.lineTo(LBL - 6, H); ctx.stroke();
  const w = S.b - S.a; $('#laTime').textContent = `顯示 ${fmtT(w)}（${fmtT(S.a - S.cap.t0)} – ${fmtT(S.b - S.cap.t0)}）· 取樣率 ${fmtRate(S.opt.rate)}`;
}
function chan(name){ return S.res?.chans.find(c => c.name === name); }
/** 一條數位訊號：太密的地方畫成色塊 */
function polyline(sig, y0, y1, color){
  const P = (W - LBL - 8) / (S.b - S.a);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  let lv = levelAt(sig, S.a), x = LBL, i = idxAfter(sig, S.a), dense = null;
  ctx.moveTo(x, lv ? y1 : y0);
  for (; i < sig.t.length && sig.t[i] <= S.b; i++){
    const nx = X(sig.t[i]);
    if (nx - x < 1.2){ if (!dense) dense = x; x = nx; lv = sig.v[i]; continue; }
    if (dense !== null){ ctx.stroke(); ctx.fillStyle = color; ctx.globalAlpha = .55; ctx.fillRect(dense, y1, x - dense + 1, y0 - y1); ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(x, lv ? y1 : y0); dense = null; }
    ctx.lineTo(nx, lv ? y1 : y0); lv = sig.v[i]; ctx.lineTo(nx, lv ? y1 : y0); x = nx;
  }
  if (dense !== null){ ctx.stroke(); ctx.fillStyle = color; ctx.globalAlpha = .55; ctx.fillRect(dense, y1, x - dense + 1, y0 - y1); ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(x, lv ? y1 : y0); }
  ctx.lineTo(W - 8, lv ? y1 : y0); ctx.stroke();
  // 放大到看得見取樣點時，畫出每個取樣點
  const per = 1e6 / S.opt.rate;
  if (P * per >= 6){
    ctx.fillStyle = color; const k0 = Math.ceil((S.a - S.cap.t0) / per), k1 = Math.floor((S.b - S.cap.t0) / per);
    for (let k = k0; k <= k1 && k - k0 < 3000; k++){ const t = S.cap.t0 + k * per; ctx.fillRect(X(t) - 1.2, (levelAt(sig, t) ? y1 : y0) - 1.2, 2.4, 2.4); }
  }
}
function drawSig(L, y){
  const c = chan(L.ch), y0 = y + L.h - 5, y1 = y + 5;
  if (!c || !c.s){ ctx.fillStyle = C.dim; ctx.font = '12px "Noto Sans TC", sans-serif'; ctx.fillText(c ? `探棒${c.src.label}` : '—', LBL + 8, y + L.h / 2); return; }
  polyline(c.s, y0, y1, c.ok ? C.sig : '#f2c94c');
  if (!c.ok){ ctx.fillStyle = '#f2c94c'; ctx.font = '11px "Noto Sans TC", sans-serif'; ctx.fillText(`接在 ${c.src.label}`, LBL + 6, y + 9); }
}
function drawCan(L, y){
  const h = chan('CANH'), l = chan('CANL'), top = y + 4, bot = y + L.h - 4, V = v => bot - (v - 1) / 3 * (bot - top);
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = C.dim;
  for (const v of [1.5, 2.5, 3.5]){ ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(LBL, V(v)); ctx.lineTo(W - 8, V(v)); ctx.stroke(); ctx.fillText(`${v} V`, W - 44, V(v) - 6); }
  for (const c of [h, l]){
    if (!c || !c.s){ continue; }
    const dom = c.src.xform === 'H' ? 3.5 : c.src.xform === 'L' ? 1.5 : 2.5;
    polyline(c.s, V(2.5), V(dom), c.name === 'CANH' ? C.h : C.l);
  }
  if ((!h || !h.s) && (!l || !l.s)){ ctx.fillStyle = C.dim; ctx.font = '12px "Noto Sans TC", sans-serif'; ctx.fillText('CANH／CANL 探棒沒有接', LBL + 8, y + L.h / 2); }
}
function drawAnns(L, y){
  const list = S.rows[L.row] || []; if (!list.length) return;
  ctx.font = '11px "JetBrains Mono", "Noto Sans TC", monospace';
  let i = 0; while (i < list.length && list[i].t1 < S.a) i++;
  let lastX = -1;
  for (; i < list.length && list[i].t0 <= S.b; i++){
    const a = list[i], x0 = Math.max(X(a.t0), LBL), x1 = Math.min(X(a.t1), W - 8), w = x1 - x0;
    if (w < .6){ if (x0 - lastX < 1) continue; lastX = x0; }
    ctx.fillStyle = C.k[a.kind] || '#888'; ctx.globalAlpha = a.kind.endsWith('bit') ? .55 : .9;
    ctx.fillRect(x0, y + 2, Math.max(w - 1, .8), L.h - 4); ctx.globalAlpha = 1;
    if (S.sel === a){ ctx.strokeStyle = C.selLine; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y + 2, Math.max(w - 2, 1), L.h - 4); }
    if (w > 14){
      const txt = ctx.measureText(a.label).width + 6 < w ? a.label : ctx.measureText(a.short).width + 4 < w ? a.short : '';
      if (txt){ ctx.fillStyle = a.kind.endsWith('bit') ? '#e2e9ed' : '#0b1014'; ctx.fillText(txt, x0 + Math.max(3, (w - ctx.measureText(txt).width) / 2), y + L.h / 2 + .5); }
    }
  }
}

/* ---------- 說明、教學、清單 ---------- */
const SEV = { err:'錯誤', warn:'注意', ok:'正常', info:'提示' };
function renderPane(){
  document.querySelectorAll('#la .la-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  const el = $('#laPane'), m = moduleById(S.id); if (!el || !m) return;
  const proto = MODULE_TYPES[m.type].analyzer;
  if (S.tab === 'learn'){
    const L = LESSONS[proto], st = L[S.step];
    el.innerHTML = `<div class="la-steps">${L.map((x, i) => `<button type="button" data-step="${i}" class="${i === S.step ? 'on' : ''}" aria-label="第 ${i + 1} 步：${esc(x.title)}">${i + 1}</button>`).join('')}</div>
      <h3>${S.step + 1}. ${esc(st.title)}</h3>${st.body.map(p => `<p>${esc(p)}</p>`).join('')}
      ${st.find.length ? `<button class="btn sm primary" data-find="${st.find.join(',')}" type="button">在波形上找</button>` : ''}
      <p class="la-try"><b>動手試試</b>${esc(st.try)}</p>
      <div class="la-nav"><button class="btn sm" data-step="${Math.max(0, S.step - 1)}" type="button" ${S.step ? '' : 'disabled'}>上一步</button><button class="btn sm" data-step="${Math.min(L.length - 1, S.step + 1)}" type="button" ${S.step < L.length - 1 ? '' : 'disabled'}>下一步</button></div>`;
    return;
  }
  if (!S.res){ el.innerHTML = `<p class="note">${S.busy ? '擷取中，請稍候…' : '按「擷取」開始量測。'}</p>`; return; }
  if (S.tab === 'list'){
    const pk = S.res.anns.filter(a => /packets$/.test(a.row)).sort((x, y) => x.t0 - y.t0);
    el.innerHTML = pk.length ? `<p class="note">共 ${pk.length} 筆，點一筆會在波形上放大。</p><ol class="la-list">${pk.slice(0, 400).map((a, i) => `<li><button type="button" data-ann="${S.res.anns.indexOf(a)}" class="${S.sel === a ? 'on' : ''}"><span class="t">${esc(fmtT(a.t0 - S.cap.t0))}</span><span class="k" style="background:${C.k[a.kind]}"></span><span class="l">${esc(a.label)}</span></button></li>`).join('')}</ol>` : '<p class="note">這段時間沒有解碼到任何資料。看「說明」分頁的分析。</p>';
    return;
  }
  if (S.sel){
    const e = explain(proto, S.sel, { t0:S.cap.t0, opt:S.opt, anns:S.res.anns, id:S.id });
    el.innerHTML = `<div class="la-card"><span class="la-kind" style="background:${C.k[S.sel.kind]}"></span><h3>${esc(e.title)}</h3>
      <span class="eyebrow">為什麼長這樣</span>${e.why.map(p => `<p>${esc(p)}</p>`).join('')}
      <dl class="specs">${e.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="la-nav"><button class="btn sm" data-move="-1" type="button">← 上一個</button><button class="btn sm" data-move="1" type="button">下一個 →</button>${e.lesson ? `<button class="btn sm ghost" data-lesson="${e.lesson}" type="button">看教學</button>` : ''}</div></div>`;
    return;
  }
  el.innerHTML = `<p class="note">點波形下方的彩色格子（位元、欄位、傳輸），這裡會說明它代表什麼、為什麼長這樣。單指拖曳可以平移，雙指可以縮放。</p>
    <ul class="la-issues">${S.res.issues.map(i => `<li class="${i.sev}"><span class="tag ${i.sev}">${SEV[i.sev]}</span><div><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p></div></li>`).join('') || '<li class="info"><span class="tag info">提示</span><div><strong>沒有發現問題</strong></div></li>'}</ul>`;
}
function select(a, zoom){
  S.sel = a; S.tab = 'info';
  if (a && zoom){ const w = S.b - S.a; if (a.t1 - a.t0 > w * .9 || a.t0 < S.a || a.t1 > S.b) zoomTo(a.t0, a.t1, .4); }
  renderPane(); draw();
}
function findKinds(kinds){
  if (!S.res){ toast('先按「擷取」。'); return; }
  const a = S.res.anns.filter(x => kinds.includes(x.kind)).sort((x, y) => x.t0 - y.t0)[0];
  if (!a){ toast('這次擷取裡找不到。確認程式在執行、探棒接對了，再擷取一次。', 'err'); return; }
  S.tab = 'info'; select(a, false); zoomTo(a.t0, a.t1, a.row === 'bits' || /bit|stuff/.test(a.kind) ? 6 : .6); draw();
}
function move(dir){
  if (!S.sel) return;
  const list = S.rows[S.sel.row] || [], i = list.indexOf(S.sel), n = list[i + dir];
  if (n){ S.sel = n; const w = S.b - S.a; if (n.t0 < S.a || n.t1 > S.b){ S.a = (n.t0 + n.t1) / 2 - w / 2; S.b = S.a + w; clampView(); } renderPane(); draw(); }
}

/* ---------- 觸控與滑鼠 ---------- */
function hit(x, y){
  for (const L of S.lanes){
    if (L.t !== 'ann' || y < L.y || y > L.y + L.h) continue;
    const t = T(x), tol = (S.b - S.a) / (W - LBL) * 4, list = S.rows[L.row] || [];
    return list.find(a => a.t0 - tol <= t && a.t1 + tol >= t) || null;
  }
  for (const L of S.lanes){ if (y >= L.y && y <= L.y + L.h){ const t = T(x), list = Object.values(S.rows).flat().filter(a => /packets$/.test(a.row)); return list.find(a => a.t0 <= t && a.t1 >= t) || null; } }
  return null;
}
function initPointer(){
  const el = $('#laCv'), pts = new Map(); let start = null, moved = false;
  el.addEventListener('pointerdown', e => { if (!S.cap) return; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x:e.offsetX, y:e.offsetY }); start = { a:S.a, b:S.b, pts:new Map(pts) }; moved = false; });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x:e.offsetX, y:e.offsetY });
    const ids = [...pts.keys()];
    if (ids.length === 1){
      const p0 = start.pts.get(ids[0]); if (!p0) return;
      const dx = e.offsetX - p0.x; if (Math.abs(dx) > 4) moved = true;
      const k = (start.b - start.a) / (W - LBL - 8); S.a = start.a - dx * k; S.b = start.b - dx * k;
    } else if (ids.length >= 2){
      const [p, q] = ids.slice(0, 2).map(i => pts.get(i)), [p0, q0] = ids.slice(0, 2).map(i => start.pts.get(i)); if (!p0 || !q0) return;
      moved = true;
      const d0 = Math.max(20, Math.abs(q0.x - p0.x)), d1 = Math.max(20, Math.abs(q.x - p.x)), mid0 = (p0.x + q0.x) / 2, mid1 = (p.x + q.x) / 2;
      const w0 = start.b - start.a, w1 = w0 * d0 / d1, tm = start.a + (mid0 - LBL) / (W - LBL - 8) * w0;
      S.a = tm - (mid1 - LBL) / (W - LBL - 8) * w1; S.b = S.a + w1;
    }
    clampView(); draw();
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!pts.size){ if (!moved) select(hit(e.offsetX, e.offsetY), false); start = null; }
    else start = { a:S.a, b:S.b, pts:new Map(pts) };
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => {
    if (!S.cap) return; e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)){ const k = (S.b - S.a) / (W - LBL); S.a += e.deltaX * k; S.b += e.deltaX * k; }
    else { const f = Math.exp(e.deltaY * .0025), tm = T(e.offsetX); S.a = tm - (tm - S.a) * f; S.b = tm + (S.b - tm) * f; }
    clampView(); draw();
  }, { passive:false });
}
function zoomBy(f){ const m = (S.a + S.b) / 2, w = (S.b - S.a) * f; S.a = m - w / 2; S.b = m + w / 2; clampView(); draw(); }

export function initAnalyzer(){
  initPointer();
  $('#laClose').addEventListener('click', closeAnalyzer);
  document.addEventListener('keydown', e => {
    if ($('#la').hidden) return;
    if (e.key === 'Escape') closeAnalyzer();
    if (e.key === 'ArrowRight' && S.sel){ e.preventDefault(); move(1); }
    if (e.key === 'ArrowLeft' && S.sel){ e.preventDefault(); move(-1); }
  });
  $('#laBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'laCap') startCapture();
    if (b.id === 'laZi') zoomBy(.5);
    if (b.id === 'laZo') zoomBy(2);
    if (b.id === 'laFit' && S.cap){ S.a = S.cap.t0; S.b = S.cap.t1; draw(); }
  });
  $('#laBar').addEventListener('change', e => {
    const t = e.target, o = S.opt;
    if (t.id === 'laSpan'){ S.span = o.span = +t.value; return; }
    if (t.id === 'laRate') o.rate = +t.value;
    if (t.id === 'laBaud') o.baud = +t.value;
    if (t.id === 'laMode'){ o.cpol = +t.value >> 1; o.cpha = +t.value & 1; }
    if (t.id === 'laCanRate') o.bitrate = +t.value;
    reanalyze(false);
  });
  document.querySelector('#la .la-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b){ S.tab = b.dataset.tab; renderPane(); } });
  $('#laPane').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step !== undefined){ S.step = +b.dataset.step; renderPane(); }
    if (b.dataset.find){ findKinds(b.dataset.find.split(',')); }
    if (b.dataset.ann !== undefined){ const a = S.res.anns[+b.dataset.ann]; S.sel = a; zoomTo(a.t0, a.t1, .15); S.tab = 'list'; renderPane(); draw(); }
    if (b.dataset.move) move(+b.dataset.move);
    if (b.dataset.lesson){ S.tab = 'learn'; S.step = +b.dataset.lesson; renderPane(); }
  });
  new ResizeObserver(() => { if (!$('#la').hidden) resize(); }).observe($('#laCv').parentElement);
  const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', () => { colors(); draw(); }) : null);
  new MutationObserver(() => { colors(); draw(); }).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
}
/** 工作台變更時：分析儀被移除就關閉視窗 */
export function analyzerBenchChanged(){ if (S.id && !moduleById(S.id)){ closeAnalyzer(); S.id = null; S.cap = null; } else if (!$('#la').hidden){ const m = moduleById(S.id); const v = variantOf(m.type, m.variant); $('#laSub').textContent = `${v.name} · ${v.part}`; renderBar(m, v, MODULE_TYPES[m.type].analyzer); } }
export { bench };
