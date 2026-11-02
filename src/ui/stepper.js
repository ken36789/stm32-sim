// 步進馬達示波器：STEP／DIR／線圈電流波形、速度曲線（加減速）、電流相量圖、微步切換、手動測試與教學
import { $, esc, toast } from './dom.js';
import { variantOf } from '../core/parts.js';
import { bench, moduleById, moduleLabel } from '../core/sim.js';
import { USTEP, LOADS, ustepName, dmodeBits, motorOf, motorInfo, motorParams, stepperTick, setDiv, setLoad, segAt, ucntAt, coilCurrents, startManual, stopManual, jumpLimit, accelLimit, isStepper } from '../core/steppers.js';

const S = { id:null, tab:'info', step:0, div:5, paused:false, pauseT:0, raf:0, man:{ rpm:180, acc:240, revs:3, dir:1, ramp:true, cont:false }, code:() => '', last:0 };
const DIVS = [.05, .1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200];   // 毫秒／格
const fmtN = n => Math.round(n).toLocaleString('en-US');

/* ---------- 開啟／關閉 ---------- */
export function openStepper(id){
  const m = moduleById(id); if (!m || !isStepper(m)) return;
  S.id = id; $('#sm').hidden = false; document.body.classList.add('la-open');
  renderHead(); renderBar(); renderPane(); resize();
  cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(frame);
}
export function closeStepper(){ $('#sm').hidden = true; document.body.classList.remove('la-open'); cancelAnimationFrame(S.raf); }
export function stepperBenchChanged(){ if ($('#sm').hidden) return; const m = moduleById(S.id); if (!m){ const o = bench.modules.find(isStepper); if (o) openStepper(o.id); else closeStepper(); return; } renderHead(); renderBar(); }
const cur = () => moduleById(S.id);

function renderHead(){
  const m = cur(), v = variantOf(m.type, m.variant), list = bench.modules.filter(isStepper);
  $('#smTitle').textContent = `${moduleLabel(m)} · 步進馬達示波器`;
  $('#smSub').textContent = `${v.name} · TB67S128FTG`;
  $('#smMotors').innerHTML = list.length > 1 ? list.map(x => `<button type="button" class="chip ${x.id === m.id ? 'hi' : ''}" data-motor="${x.id}">${esc(moduleLabel(x))}</button>`).join('') : '';
}
function renderBar(){
  const m = cur(), mo = motorOf(m);
  $('#smBar').innerHTML = `<div class="sm-us" role="group" aria-label="微步（DMODE 指撥開關）"><span>微步<small>DMODE ${dmodeBits(mo.div)}</small></span>${USTEP.map(d => `<button type="button" class="${d === mo.div ? 'on' : ''}" data-div="${d}">${d === 1 ? '全步' : '1/' + d}</button>`).join('')}</div>
    <label>時間刻度<select id="smDiv">${DIVS.map((d, i) => `<option value="${i}" ${i === S.div ? 'selected' : ''}>${d >= 1 ? d + ' ms' : d * 1000 + ' µs'}／格</option>`).join('')}</select></label>
    <label>負載<select id="smLoad">${LOADS.map(l => `<option value="${l.id}" ${l.id === mo.load ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
    <button class="btn sm" id="smPause" type="button">${S.paused ? '▶ 繼續' : '❚❚ 暫停'}</button>`;
}

/* ---------- 畫布 ---------- */
let cv, cx, sv, sx, W = 0, H = 0, W2 = 0, H2 = 0;
function resize(){
  cv = $('#smCv'); sv = $('#smSp'); if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), fit = (c, w, h) => { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g; };
  W = cv.parentElement.clientWidth; H = Math.max(200, cv.parentElement.clientHeight); cx = fit(cv, W, H);
  W2 = sv.parentElement.clientWidth; H2 = Math.max(150, sv.parentElement.clientHeight); sx = fit(sv, W2, H2);
}
const COL = { bg:'#071014', grid:'rgba(255,255,255,.08)', grid2:'rgba(255,255,255,.18)', dim:'#7c8f99', lbl:'rgba(255,255,255,.7)', step:'#ffd166', dir:'#5fd3f3', a:'#ff7ad9', b:'#5fe08a', cmd:'#ffd166', act:'#5fe08a', stall:'#ff6d76' };
const LBL = 64;
function frame(){
  if ($('#sm').hidden) return;
  S.raf = requestAnimationFrame(frame);
  const m = cur(); if (!m) return;
  stepperTick();
  const now = performance.now();
  if (now - S.last < 33) return; S.last = now;              // 30 fps 就夠了
  const t1 = S.paused ? S.pauseT : now;
  drawScope(m, t1); drawSpeed(m, t1); readouts(m);
  if (S.tab === 'info' && Math.floor(now / 500) !== S.infoTick){ S.infoTick = Math.floor(now / 500); renderPane(true); }
}
function drawScope(m, t1){
  const g = cx, mo = motorOf(m), span = DIVS[S.div] * 10, t0 = t1 - span, X = t => LBL + (t - t0) / span * (W - LBL - 8);
  g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
  for (let i = 0; i <= 10; i++){ const x = LBL + i * (W - LBL - 8) / 10; g.strokeStyle = i % 5 ? COL.grid : COL.grid2; g.beginPath(); g.moveTo(x, 18); g.lineTo(x, H); g.stroke(); }
  g.font = '11px "JetBrains Mono", monospace'; g.fillStyle = COL.dim; g.textBaseline = 'middle';
  const dv = DIVS[S.div]; g.fillText(`${dv >= 1 ? dv + ' ms' : dv * 1000 + ' µs'}／格   ${S.paused ? '（暫停）' : '（即時）'}`, LBL, 9);
  const lanes = [['STEP', 'step', 1], ['DIR', 'dir', 1], ['線圈 A', 'a', 2], ['線圈 B', 'b', 2]], unit = (H - 22) / 6.4;
  let y = 22;
  for (const [name, key, h] of lanes){
    const top = y + 4, bot = y + unit * h - 4, mid = (top + bot) / 2;
    g.fillStyle = COL.lbl; g.font = '600 12px "JetBrains Mono", "Noto Sans TC", monospace'; g.fillText(name, 8, mid);
    g.strokeStyle = COL[key]; g.lineWidth = 1.6; g.beginPath();
    if (key === 'step'){
      const k0 = segAt(mo, t0); let dense = false;
      for (let k = Math.max(0, k0); k < mo.hist.length && mo.hist[k].t < t1; k++){
        const sg = mo.hist[k], end = Math.min(t1, k + 1 < mo.hist.length ? mo.hist[k + 1].t : t1);
        if (!(sg.f > 0) || !sg.en) continue;
        const s0 = Math.max(t0, sg.t), cnt = sg.f * (end - s0) / 1000;
        if (cnt / Math.max(1, X(end) - X(s0)) > .35){ dense = true; g.fillStyle = COL.step; g.globalAlpha = .55; g.fillRect(X(s0), top, Math.max(1, X(end) - X(s0)), bot - top); g.globalAlpha = 1; continue; }
        const per = 1000 / sg.f; const n = Math.ceil(sg.acc + sg.f * (s0 - sg.t) / 1000);
        for (let tp = sg.t + (n - sg.acc) * per; tp < end; tp += per){ const xa = X(tp), xb = Math.max(xa + 1, X(Math.min(end, tp + per / 2))); g.moveTo(xa, bot); g.lineTo(xa, top); g.lineTo(xb, top); g.lineTo(xb, bot); }
      }
      g.moveTo(LBL, bot); g.lineTo(W - 8, bot); g.stroke();
      if (dense){ g.fillStyle = '#0b1014'; g.font = '11px "Noto Sans TC", sans-serif'; g.fillText('脈波太密，選小一點的時間刻度就能看到每一個脈波', LBL + 8, mid); }
    } else if (key === 'dir'){
      let first = true;
      for (let x = LBL; x <= W - 8; x += 2){ const t = t0 + (x - LBL) / (W - LBL - 8) * span, s = mo.hist[segAt(mo, t)], yv = s && s.dir > 0 ? top : bot; if (first){ g.moveTo(x, yv); first = false; } else g.lineTo(x, yv); }
      g.stroke(); g.fillStyle = COL.dim; g.font = '10px "Noto Sans TC", sans-serif'; g.fillText('高＝順時針', W - 70, top + 6);
    } else {
      g.strokeStyle = COL.grid2; g.lineWidth = 1; g.beginPath(); g.moveTo(LBL, mid); g.lineTo(W - 8, mid); g.stroke();
      g.strokeStyle = COL[key]; g.lineWidth = 1.6; g.beginPath();
      const idx = key === 'a' ? 0 : 1, amp = (bot - top) / 2; let first = true;
      for (let x = LBL; x <= W - 8; x += 1){
        const t = t0 + (x - LBL) / (W - LBL - 8) * span, u = ucntAt(mo, t), s = u.seg, I = coilCurrents(u.ucnt, s ? s.div : mo.div, s ? s.en : false)[idx], yv = mid - I * amp;
        if (first){ g.moveTo(x, yv); first = false; } else g.lineTo(x, yv);
      }
      g.stroke();
      const iset = motorParams(m).v.Iset; g.fillStyle = COL.dim; g.font = '10px "JetBrains Mono", monospace'; g.fillText(`+${iset} A`, LBL - 40, top + 4); g.fillText(`−${iset} A`, LBL - 40, bot - 4);
    }
    y += unit * h;
  }
}
function drawSpeed(m, t1){
  const g = sx, mo = motorOf(m), info = motorInfo(m), span = 10000, t0 = t1 - span, PH = Math.min(H2 - 24, 150, W2 * .34), PW = PH + 20, w = W2 - PW - 10;
  g.fillStyle = COL.bg; g.fillRect(0, 0, W2, H2);
  const samp = mo.samp.filter(s => s.t >= t0 && s.t <= t1), fs = info.fullSteps;
  const rpmOf = w => w / fs * 60;
  let max = 60; for (const s of samp) max = Math.max(max, Math.abs(rpmOf(s.cmdW)) * 1.15, Math.abs(rpmOf(s.w)) * 1.1);
  max = [60, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 4800, 6000, 12000].find(x => x >= max) || Math.ceil(max / 6000) * 6000;
  // 圖例：標題下面一行（窄的時候自動換行）
  g.font = '10px "Noto Sans TC", sans-serif'; g.textBaseline = 'middle';
  const legend = [['━ 指令（STEP 換算）', COL.cmd], ['━ 轉子實際', COL.act], ['■ 加速', 'rgba(95,211,243,.95)'], ['■ 減速', 'rgba(255,159,67,.95)']], lpos = [];
  let lx = 50, ly = 23;
  for (const [txt] of legend){ const lw = g.measureText(txt).width; if (lx + lw > w - 4 && lx > 50){ lx = 50; ly += 13; } lpos.push([lx, ly]); lx += lw + 12; }
  const top = ly + 10, X = t => 46 + (t - t0) / span * (w - 52), Y = r => top + (1 - (r + max) / (2 * max)) * (H2 - top - 18);
  g.font = '10px "JetBrains Mono", monospace';
  for (const r of [-max, -max / 2, 0, max / 2, max]){ g.strokeStyle = r ? COL.grid : COL.grid2; g.beginPath(); g.moveTo(46, Y(r)); g.lineTo(w - 6, Y(r)); g.stroke(); g.fillStyle = COL.dim; g.fillText(String(r), 4, Y(r)); }
  for (let s = 0; s <= 10; s += 2){ g.fillStyle = COL.dim; g.fillText(`${s - 10}s`, X(t0 + s * 1000) - 8, H2 - 8); }
  g.fillStyle = COL.lbl; g.font = '600 11px "Noto Sans TC", sans-serif'; g.fillText('轉速 RPM（最近 10 秒）', 50, 8);
  // 加速／減速區段的底色
  // 和約 50 ms 前比較指令速度：變快＝加速、變慢＝減速，連續的區段合併成一塊
  const all = mo.samp, i0 = all.indexOf(samp[0]); let run = null;
  const flush = tEnd => { if (run){ g.fillStyle = run.k > 0 ? 'rgba(95,211,243,.13)' : 'rgba(255,159,67,.15)'; g.fillRect(X(run.t), top, Math.max(1, X(tEnd) - X(run.t)), H2 - top - 18); run = null; } };
  for (let i = Math.max(0, i0); i0 >= 0 && i < all.length && all[i].t <= t1; i++){
    const prev = all[Math.max(0, i - 12)], d = Math.abs(all[i].cmdW) - Math.abs(prev.cmdW), k = d > 1e-6 ? 1 : d < -1e-6 ? -1 : 0;
    if (!run || run.k !== k){ flush(all[i].t); if (k) run = { k, t:all[i].t }; }
  }
  flush(t1);
  g.font = '10px "Noto Sans TC", sans-serif'; legend.forEach(([txt, c], i) => { g.fillStyle = c; g.fillText(txt, lpos[i][0], lpos[i][1]); });
  const line = (key, color) => { g.strokeStyle = color; g.lineWidth = 1.8; g.beginPath(); samp.forEach((s, i) => { const x = X(s.t), y = Y(rpmOf(s[key])); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); };
  line('cmdW', COL.cmd); line('w', COL.act);
  if (info.stalled){ g.fillStyle = COL.stall; g.font = '700 13px "Noto Sans TC", sans-serif'; g.fillText('失步！', w - 54, top + 10); }
  // 電流相量圖：線圈 A＝橫軸、B＝縱軸
  const cxp = w + PW / 2, cyp = H2 / 2 + 4, R = PH / 2 - 14, div = mo.div;
  g.strokeStyle = COL.grid2; g.beginPath(); g.arc(cxp, cyp, R, 0, 7); g.stroke(); g.beginPath(); g.moveTo(cxp - R - 4, cyp); g.lineTo(cxp + R + 4, cyp); g.moveTo(cxp, cyp - R - 4); g.lineTo(cxp, cyp + R + 4); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.45)';
  const n = 4 * div, every = Math.max(1, Math.floor(n / 128));
  for (let k = 0; k < n; k += every){ const [a, b] = coilCurrents(k, div, true); g.fillRect(cxp + a * R - 1, cyp - b * R - 1, 2, 2); }
  const u = ucntAt(mo, t1), [ia, ib] = coilCurrents(u.ucnt, div, u.seg ? u.seg.en : false);
  g.strokeStyle = COL.step; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cxp, cyp); g.lineTo(cxp + ia * R, cyp - ib * R); g.stroke();
  g.fillStyle = COL.lbl; g.font = '600 11px "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.fillText(`電流相量（每圈 ${n} 點）`, cxp, 8); g.textAlign = 'left';
}
function readouts(m){
  const i = motorInfo(m), el = $('#smRead'); if (!el) return;
  const acc = recentAccel(m);
  el.innerHTML = [['STEP 頻率', `${fmtN(i.pps)} pps`], ['指令轉速', `${Math.abs(i.cmdRpm).toFixed(1)} RPM`], ['實際轉速', `${Math.abs(i.rpm).toFixed(1)} RPM`], ['加速度', `${fmtN(acc)} pps/s`], ['微步', i.div === 1 ? '全步' : `1/${i.div}`], ['每個脈波', `${i.stepDeg.toFixed(i.stepDeg < .1 ? 4 : 3)}°`], ['一圈脈波', fmtN(i.perRev)], ['位置', `${i.revs.toFixed(2)} 圈`], ['失步', i.lost ? `${Math.abs(i.lost)} 全步` : '無']]
    .map(([k, v]) => `<div><span>${k}</span><b class="${k === '失步' && i.lost ? 'bad' : ''}">${v}</b></div>`).join('');
}
/** 最近 0.1 秒 STEP 頻率的變化率（pps/s） */
function recentAccel(m){
  const s = motorOf(m).samp; if (s.length < 3) return 0;
  const b = s[s.length - 1]; let a = b; for (let i = s.length - 1; i >= 0 && b.t - s[i].t < 120; i--) a = s[i];
  return b.t > a.t ? (Math.abs(b.pps) - Math.abs(a.pps)) / ((b.t - a.t) / 1000) : 0;
}

/* ---------- 側邊欄 ---------- */
function codeMicrostep(m){ const list = bench.modules.filter(isStepper), k = list.indexOf(m) + 1, mt = S.code().match(new RegExp(`#define\\s+M${k}_MICROSTEP\\s+(\\d+)`)); return mt ? +mt[1] : null; }
/** live＝true：結構沒變時只更新數字（不重畫按鈕，點按才不會被打斷） */
function renderPane(live){
  if (!live) S.paneKey = null;
  document.querySelectorAll('#sm .la-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  const el = $('#smPane'), m = cur(); if (!el || !m) return;
  const i = motorInfo(m), mo = motorOf(m), per = i.perRev;
  if (S.tab === 'info'){
    const fw = codeMicrostep(m), acc = recentAccel(m), v = Math.abs(i.pps);
    const warn = [];
    if (!i.ok) warn.push(['err', '驅動模組沒有供電', 'IOREF（VCC）要接 3V3、GND 要接地，TB67S128FTG 才會動作。']);
    else if (!i.en && !mo.manual) warn.push(['warn', 'ENABLE 是低電位', 'TB67S128FTG 的 ENABLE 要高電位才會送電給馬達。程式要把 EN 腳設成高電位。']);
    if (i.src === 'mcu' && i.k < 0) warn.push(['warn', 'CLK 沒有接到 STEP 輸出', 'CLK 要接到計時器的 PWM 輸出腳（接線分頁的「建議接線」會自動接好）。']);
    if (fw && fw !== mo.div && !mo.manual) warn.push(['warn', `程式以為是 1/${fw}，模組設成 ${ustepName(mo.div)}`, `程式算 pps 時用的是 MICROSTEP＝${fw}。同樣的脈波數，馬達實際只轉 ${fw > mo.div ? fw / mo.div : `1/${mo.div / fw}`} 倍的距離和速度——這就是微步設定和韌體不一致時會發生的事。要讓速度回到原本的樣子，把程式裡的 MICROSTEP 改成 ${mo.div}，再重新檢測、編譯、燒錄。`, `<button class="btn sm" id="smFix" type="button">把範例程式改成 ${ustepName(mo.div)}</button>`]);
    if (i.lost) warn.push(['err', `失步：少走了 ${Math.abs(i.lost)} 個全步`, '磁場轉得比轉子能跟上的還快（加速度太大、速度太高或負載太重），轉子滑掉了。步進馬達沒有回授，MCU 不會知道它少走了——所以要用加減速（ramp），並把最高速度留在扭力夠的範圍。']);
    const html = `${warn.map(([s, t, b, btn]) => `<div class="sm-warn ${s}"><strong>${esc(t)}</strong><p>${esc(b)}</p>${btn ? `<div class="la-nav">${btn}</div>` : ''}</div>`).join('')}
      <h3>現在發生什麼事</h3>
      <p>${mo.manual ? '控制台的脈波產生器正在送 STEP（手動測試）。' : 'MCU 的計時器在送 STEP 脈波。'}TB67S128FTG 每收到一個脈波（CLK 上升緣）前進一個微步。</p>
      <p class="sm-eq" data-k="rpm">轉速 ＝ pps ÷ (全步數 × 微步) × 60<br>＝ ${fmtN(v)} ÷ (${i.fullSteps} × ${mo.div}) × 60 ＝ <b>${(v / per * 60).toFixed(1)} RPM</b></p>
      <p class="sm-eq" data-k="acc">加速度 ＝ pps 每秒的變化 ＝ <b>${fmtN(acc)} pps/s</b>（${(acc / per).toFixed(2)} 圈／秒²）</p>
      <p>${ustepName(mo.div)}：一個全步 ${motorParams(m).v.step}° 分成 ${mo.div} 份，每個脈波轉 ${i.stepDeg.toFixed(4)}°。看示波器的線圈 A／B：電流是一階一階的正弦波，微步越細，台階越小、越平滑，轉得越安靜。</p>
      <h3 data-k="th">同樣 ${Math.max(1, Math.round(Math.abs(i.cmdRpm) || 60))} RPM，不同微步需要的 pps</h3>
      <table class="sm-tbl" data-k="tbl"><tr><th>微步</th><th>pps</th><th>1 MHz 計時器的 ARR</th></tr>${USTEP.map(d => { const r = Math.max(1, Math.round(Math.abs(i.cmdRpm) || 60)), p = r / 60 * i.fullSteps * d, arr = Math.round(1e6 / p) - 1, real = 1e6 / (arr + 1); return `<tr class="${d === mo.div ? 'on' : ''}"><td>${ustepName(d)}</td><td>${fmtN(p)}</td><td>${arr >= 1 ? `${fmtN(arr)}${Math.abs(real - p) / p > .01 ? `（實際 ${fmtN(real)}，差 ${((real - p) / p * 100).toFixed(1)}%）` : ''}` : '太快'}</td></tr>`; }).join('')}</table>
      <p class="note">微步越細，同樣轉速需要的脈波越快：計時器的 ARR 變小以後，能設定的頻率就變得很跳，實際速度和想要的會有誤差。</p>`;
    const key = `${mo.div}|${mo.manual ? 1 : 0}|${warn.map(w => w[1]).join('|')}`;
    if (live && key === S.paneKey){
      const tpl = document.createElement('template'); tpl.innerHTML = html;
      tpl.content.querySelectorAll('[data-k]').forEach(n => { const o = el.querySelector(`[data-k="${n.dataset.k}"]`); if (o && o.innerHTML !== n.innerHTML) o.innerHTML = n.innerHTML; });
    } else { el.innerHTML = html; S.paneKey = key; }
    return;
  }
  if (live) return;
  if (S.tab === 'manual'){
    const M = S.man, v = M.rpm / 60 * per, a = M.acc / 60 * per, steps = M.cont ? Infinity : M.revs * per;
    const tAcc = v / a, sAcc = v * v / (2 * a), tri = !M.cont && 2 * sAcc > steps, vPeak = tri ? Math.sqrt(a * steps) : v;
    const total = M.cont ? null : tri ? 2 * vPeak / a : 2 * tAcc + (steps - 2 * sAcc) / v;
    const jl = jumpLimit(m), al = accelLimit(m, M.rpm / 60) ;
    el.innerHTML = `<p class="note">由控制台的脈波產生器接管這顆馬達的 STEP（不經過 MCU 程式），用來試試看不同的速度、加速度和微步。</p>
      <label class="ctl" for="smRpm">目標速度<input type="range" id="smRpm" min="10" max="1200" step="10" value="${M.rpm}"><output>${M.rpm} RPM</output></label>
      <label class="ctl" for="smAcc">加速度<input type="range" id="smAcc" min="10" max="6000" step="10" value="${M.acc}"><output>${M.acc} RPM/s</output></label>
      <label class="ctl" for="smRevs">移動距離<input type="range" id="smRevs" min="0.25" max="20" step="0.25" value="${M.revs}" ${M.cont ? 'disabled' : ''}><output>${M.cont ? '連續' : M.revs + ' 圈'}</output></label>
      <div class="sm-opts"><label><input type="checkbox" id="smRamp" ${M.ramp ? 'checked' : ''}> 使用加減速（ramp）</label><label><input type="checkbox" id="smCont" ${M.cont ? 'checked' : ''}> 連續轉動</label><label><input type="checkbox" id="smCcw" ${M.dir < 0 ? 'checked' : ''}> 逆時針</label></div>
      <div class="la-nav"><button class="btn sm primary" id="smRun" type="button">▶ 執行</button><button class="btn sm" id="smStop" type="button" ${mo.manual ? '' : 'disabled'}>■ 停止，交還給 MCU</button></div>
      <canvas id="smTrap" height="120"></canvas>
      <table class="sm-tbl"><tr><td>最高 pps</td><td>${fmtN(v)}（${M.rpm} RPM × ${per} ÷ 60）</td></tr><tr><td>加速度</td><td>${fmtN(a)} pps/s</td></tr>
        ${M.ramp ? `<tr><td>加速時間</td><td>v ÷ a ＝ ${tAcc.toFixed(2)} 秒</td></tr><tr><td>加速距離</td><td>v² ÷ (2a) ＝ ${fmtN(sAcc)} 步（${(sAcc / per).toFixed(2)} 圈）</td></tr>
        ${tri ? `<tr><td>形狀</td><td>距離太短，還沒加到最高速就要減速：三角形，最高只到 ${(vPeak / per * 60).toFixed(0)} RPM</td></tr>` : `<tr><td>形狀</td><td>梯形：加速 → 等速 → 減速</td></tr>`}` : ''}
        ${total !== null ? `<tr><td>總時間</td><td>${M.ramp ? total.toFixed(2) : (steps / v).toFixed(2)} 秒</td></tr>` : ''}</table>
      ${!M.ramp && M.rpm / 60 > jl ? `<div class="sm-warn warn"><strong>沒有加減速，很可能失步</strong><p>這個負載下，直接從 0 跳到約 ${(jl * 60).toFixed(0)} RPM 以上，轉子就跟不上磁場了。勾選「使用加減速」再試一次。</p></div>` : ''}
      ${M.ramp && M.acc / 60 > al ? `<div class="sm-warn warn"><strong>加速度可能太大</strong><p>在 ${M.rpm} RPM 附近，這顆馬達扣掉負載後大約只能做到 ${(al * 60).toFixed(0)} RPM/s 的加速度（轉速越高，扭力越小）。</p></div>` : ''}`;
    drawTrap(v, a, steps, M.ramp, per);
    return;
  }
  const L = LESSONS[S.step];
  el.innerHTML = `<div class="la-steps">${LESSONS.map((x, k) => `<button type="button" data-step="${k}" class="${k === S.step ? 'on' : ''}" aria-label="第 ${k + 1} 步：${esc(x.title)}">${k + 1}</button>`).join('')}</div>
    <h3>${S.step + 1}. ${esc(L.title)}</h3>${L.body.map(p => `<p>${esc(p)}</p>`).join('')}
    <p class="la-try"><b>動手試試</b>${esc(L.try)}</p>
    <div class="la-nav"><button class="btn sm" data-step="${Math.max(0, S.step - 1)}" type="button" ${S.step ? '' : 'disabled'}>上一步</button><button class="btn sm" data-step="${Math.min(LESSONS.length - 1, S.step + 1)}" type="button" ${S.step < LESSONS.length - 1 ? '' : 'disabled'}>下一步</button></div>`;
}
/** 手動測試的速度曲線預覽 */
function drawTrap(v, a, steps, ramp, per){
  const c = $('#smTrap'); if (!c) return;
  c.style.width = '100%'; c.style.height = '130px';
  const w = Math.max(200, c.clientWidth), h = 130, dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = COL.bg; g.fillRect(0, 0, w, h);
  const pts = [];
  if (!ramp){ const T = Number.isFinite(steps) ? steps / v : 2; pts.push([0, 0], [0, v], [T, v], [T, 0]); }
  else if (!Number.isFinite(steps)){ const ta = v / a; pts.push([0, 0], [ta, v], [ta * 2 + 1, v]); }
  else { const sA = v * v / (2 * a); if (2 * sA > steps){ const vp = Math.sqrt(a * steps), tp = vp / a; pts.push([0, 0], [tp, vp], [2 * tp, 0]); } else { const ta = v / a, tc = (steps - 2 * sA) / v; pts.push([0, 0], [ta, v], [ta + tc, v], [2 * ta + tc, 0]); } }
  const T = pts[pts.length - 1][0] || 1, X = t => 8 + t / T * (w - 16), Y = s => h - 18 - s / Math.max(...pts.map(q => q[1]), 1) * (h - 44);
  g.strokeStyle = COL.grid2; g.beginPath(); g.moveTo(8, Y(0)); g.lineTo(w - 8, Y(0)); g.stroke();
  g.fillStyle = 'rgba(255,209,102,.12)'; g.beginPath(); pts.forEach(([t, s], i) => i ? g.lineTo(X(t), Y(s)) : g.moveTo(X(t), Y(s))); g.lineTo(X(T), Y(0)); g.closePath(); g.fill();
  g.strokeStyle = COL.cmd; g.lineWidth = 2; g.beginPath(); pts.forEach(([t, s], i) => i ? g.lineTo(X(t), Y(s)) : g.moveTo(X(t), Y(s))); g.stroke();
  const top = Math.max(...pts.map(q => q[1]));
  g.textBaseline = 'alphabetic'; g.fillStyle = COL.dim; g.font = '10px "JetBrains Mono", monospace'; g.fillText(`${fmtN(top)} pps`, X(pts[1][0]) + 4, Y(top) + 13); g.textAlign = 'right'; g.fillText(`${T.toFixed(2)} s`, w - 8, h - 4); g.textAlign = 'left'; g.fillText('0', 8, h - 4);
  g.fillStyle = COL.lbl; g.font = '10.5px "Noto Sans TC", sans-serif'; g.fillText('速度對時間：斜邊的斜率＝加速度，面積＝走的步數', 8, 13);
}

/* ---------- 教學 ---------- */
const LESSONS = [
  { title:'步進馬達怎麼轉', body:['步進馬達有兩組線圈（A、B）。驅動 IC 依順序改變兩組線圈的電流方向，產生一個一格一格轉動的磁場，轉子跟著磁場走。', '1.8° 的馬達轉一圈要 200 個「全步」。每一步走多少是固定的，所以只要數脈波就知道轉了多少——不需要編碼器（這叫開迴路控制）。'], try:'看示波器的線圈 A、B：兩個波形差 90°，就像一個在算 cos、一個在算 sin。右下的相量圖就是這兩個電流畫成的向量。' },
  { title:'STEP／DIR 介面', body:['TB67S128FTG 用 CLK-IN 模式：MCU 只要給 CLK（STEP）脈波和 CW/CCW（方向）兩條線，電流怎麼切換都由 IC 自己處理。', 'CLK 每個上升緣＝前進一個微步；ENABLE 要高電位才會送電。'], try:'把時間刻度調到 0.2 ms／格，看 STEP 一個脈波，線圈電流就跳一階。' },
  { title:'微步（microstep）', body:['DMODE 指撥開關把一個全步再細分：1/2、1/4 … 1/128。電流不再是方波，而是一階一階的正弦波。', '好處：轉得平順、安靜、低速不抖，定位更細。代價：同樣轉速需要更多脈波；每個微步的扭力變小，不保證每個微步都走得那麼準。'], try:'在上方切換「全步」和「1/128」，比較線圈電流的形狀和相量圖上的點數。' },
  { title:'pps 和轉速', body:['pps（pulses per second）＝每秒送幾個 STEP 脈波＝每秒走幾個微步。', '轉速 RPM ＝ pps ÷ (200 × 微步) × 60。例如 1/16 微步、6400 pps：6400 ÷ 3200 × 60 ＝ 120 RPM。'], try:'程式不變，只把微步從 1/16 改成 1/64：同樣的 pps，馬達只剩 1/4 的速度。「說明」分頁會提醒程式和模組設定不一致。' },
  { title:'為什麼需要加減速（ramp）', body:['轉子和負載有慣性，速度不能瞬間改變。如果 pps 一下子跳得太高，磁場已經跑走了、轉子還沒跟上，落後超過 2 個全步就會「失步」——少走好幾步，甚至停在原地嗡嗡叫。', '所以韌體讓 pps 慢慢增加（加速度 a，單位 pps/s），快到目標時再慢慢減速。'], try:'到「手動測試」，負載選「大飛輪」，取消「使用加減速」，目標 300 RPM 按執行——看速度曲線和「失步」。再勾回加減速試一次。' },
  { title:'梯形加減速的公式', body:['加速時間 t ＝ v ÷ a；加速過程走的步數 ＝ v² ÷ (2a)。', '要在目標位置剛好停下來，就要在「剩下的步數 ≤ v² ÷ (2a)」時開始減速。範例程式的 M1_Update() 每 10 ms 做的就是這件事。距離太短時還沒加到最高速就要減速，速度曲線會變成三角形。'], try:'看速度曲線：藍色底是加速、橘色底是減速，斜邊的斜率就是加速度。' },
  { title:'速度越高，扭力越小', body:['線圈有電感，轉得越快電流越來不及建立，扭力就越小。所以高速時能用的加速度也越小，超過某個速度就怎麼樣都會失步。', '負載越重（慣量越大），同樣的扭力能產生的加速度越小。'], try:'手動測試：負載「鋁圓盤」，目標 900 RPM、加速度 1200 RPM/s——看它到哪個速度失步。' },
  { title:'計時器解析度', body:['STEP 用計時器 PWM 產生：頻率 ＝ 計時器時脈 ÷ (ARR＋1)。1 MHz 時脈下，6400 pps 的 ARR 是 155，很準；1/128 微步、120 RPM 要 51200 pps，ARR 只剩 18，能設定的頻率很跳。', '實際產品會把計時器時脈設高一點，或用每一步重新計算間隔的演算法。'], try:'「說明」分頁底下的表格列出每種微步需要的 pps 和 ARR 誤差。' },
];

/* ---------- 事件 ---------- */
export function initStepper(o){
  S.code = o.code || S.code;
  $('#smClose').addEventListener('click', closeStepper);
  document.addEventListener('keydown', e => { if (!$('#sm').hidden && e.key === 'Escape') closeStepper(); });
  $('#smMotors').addEventListener('click', e => { const b = e.target.closest('[data-motor]'); if (b) openStepper(b.dataset.motor); });
  $('#smBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const m = cur();
    if (b.dataset.div){ setDiv(m, +b.dataset.div); renderBar(); renderPane(); o.changed?.(); toast(`${moduleLabel(m)}：微步改成 ${ustepName(+b.dataset.div)}（DMODE ${dmodeBits(+b.dataset.div)}）。`); }
    if (b.id === 'smPause'){ S.paused = !S.paused; S.pauseT = performance.now(); renderBar(); }
  });
  $('#smBar').addEventListener('change', e => { if (e.target.id === 'smDiv') S.div = +e.target.value; if (e.target.id === 'smLoad'){ setLoad(cur(), +e.target.value); o.changed?.(); } });
  document.querySelector('#sm .la-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b){ S.tab = b.dataset.tab; renderPane(); } });
  const pane = $('#smPane');
  pane.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const m = cur();
    if (b.dataset.step !== undefined){ S.step = +b.dataset.step; renderPane(); }
    if (b.id === 'smRun'){ const M = S.man, per = motorInfo(m).perRev; startManual(m, { pps:M.rpm / 60 * per, accel:M.acc / 60 * per, steps:M.cont ? Infinity : M.revs * per, ramp:M.ramp, dir:M.dir }); renderPane(); toast('手動測試開始：控制台接管這顆馬達的 STEP。'); }
    if (b.id === 'smFix'){ o.example?.(); renderPane(); }
    if (b.id === 'smStop'){ stopManual(m); renderPane(); toast('已交還給 MCU 程式控制。'); }
  });
  pane.addEventListener('input', e => {
    const t = e.target, M = S.man;
    if (t.id === 'smRpm') M.rpm = +t.value; if (t.id === 'smAcc') M.acc = +t.value; if (t.id === 'smRevs') M.revs = +t.value;
    if (t.id === 'smRamp') M.ramp = t.checked; if (t.id === 'smCont') M.cont = t.checked; if (t.id === 'smCcw') M.dir = t.checked ? -1 : 1;
    if (t.type === 'range'){ const out = t.parentElement.querySelector('output'); if (out) out.textContent = t.id === 'smRpm' ? `${M.rpm} RPM` : t.id === 'smAcc' ? `${M.acc} RPM/s` : `${M.revs} 圈`; clearTimeout(S.rt); S.rt = setTimeout(renderPane, 250); }
    else renderPane();
  });
  new ResizeObserver(() => { if (!$('#sm').hidden) resize(); }).observe($('#smCv').parentElement);
}
