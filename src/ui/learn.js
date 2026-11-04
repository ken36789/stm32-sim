// 闖關學習：學習地圖（選關）、浮在 3D 畫面上的關卡卡片（即時打勾的步驟、提示、解答）、星等與進度。
// 進度只存在這台裝置的瀏覽器（localStorage）。
import { $, esc, toast } from './dom.js';
import { MODULE_TYPES } from '../core/parts.js';
import { bench, wires, removeWire, pinListeners } from '../core/sim.js';
import { BOARD_BY_ID, DEFAULT_BOARD } from '../core/boards.js';
import { MISSIONS, CHALLENGES, byId, boardFits, prepare, makeCtx, evaluate, hintText, starsOf } from '../core/missions.js';
import { loadWires } from '../core/project.js';
import { CONFIG } from '../config.js';

const PKEY = 'mcu-lab-progress', AKEY = 'mcu-lab-active', BKEY = 'mcu-lab-backup';
let env = null, A = null, serial = '', tab = 'mission', collapsed = false, lastSteps = '', leaving = false;
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch (_){ return d; } };
const save = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_){ /* 私密瀏覽：只是不存 */ } };
const progress = () => load(PKEY, {});
const starStr = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const listOf = kind => kind === 'mission' ? MISSIONS : CHALLENGES;
const persist = () => save(AKEY, A && { id:A.id, exp:A.exp, fix:A.fix, board:A.board, hints:A.hints, answer:A.answer, assisted:A.assisted, done:A.done, stars:A.stars });

/* ---------- 給 main.js 呼叫 ---------- */
export function learnSerial(s){ serial += s; if (serial.length > 40000) serial = serial.slice(-30000); }
export function learnRun(st){ if (st === 'run') serial = ''; }
export function learnAnalyzed({ proto, opt, res }){
  if (!A || proto !== 'uart') return;
  const packets = res.anns.filter(a => /packets$/.test(a.row)).length, bad = res.issues.some(i => (i.sev === 'err' || i.sev === 'warn') && /框架|鮑率|錯誤/.test(i.title));
  if (opt.baud === 115200 && packets && !bad) A.flag.uartOk = true;
  if (opt.baud !== 115200 && (bad || !packets)) A.flag.uartBad = true;
}
/** 使用者按了「建議接線」或「載入範例程式」 */
export function learnAssist(kind){
  if (!A || A.done) return;
  if (A.kind === 'challenge'){ if (!A.answer){ A.answer = true; toast('故障挑戰用了「建議接線」或「範例程式」等於看解答：這一關記 1 顆星。'); } }
  else if (kind === 'suggest' && !A.assisted && !A.answer){ A.assisted = true; toast('用了「建議接線」：這一關最多 2 顆星。自己接線可以拿 3 顆星。'); }
  persist(); renderHud();
}
export function learnTick(){
  if (!A || A.done) return;
  const x = byId(A.id), r = evaluate(x, ctxNow());
  renderSteps(r.steps);
  if (r.done) complete();
}

/* ---------- 開始、離開、過關 ---------- */
function start(id){
  const x = byId(id); if (!x) return;
  if (!A) save(BKEY, env.snapshotNow());                  // 從自由模式進來：先備份原本的工作台
  const before = bench.board.id, p = prepare(x, before);
  env.benchLoaded({ code:p.code, asExample:false });
  A = { id, kind:x.kind, exp:p.exp, fix:p.fix, board:p.board, hints:0, answer:false, assisted:false, done:false, stars:0, seq0:0, cnt:{}, v:{}, flag:{} };
  if (x.kind === 'challenge') env.quickFlash();
  A.seq0 = env.flashSeq(); serial = x.kind === 'challenge' ? serial : '';
  collapsed = matchMedia('(max-width: 760px)').matches; leaving = false; lastSteps = ''; nextHtml = '';   // 手機：預設只顯示下一步，不擋住 3D 畫面
  persist(); closeMap(); renderHud(); learnTick();
  env.showTab(x.kind === 'challenge' ? 'serial' : 'code');
  if (p.board !== before) toast(`這一關需要 ${BOARD_BY_ID[before].name} 沒有的功能，已換成 ${BOARD_BY_ID[p.board].name}。`);
  env.track(`start-${id}`);
}
function complete(){
  A.done = true; A.stars = starsOf(A.hints > 0 || A.assisted, A.answer);
  const pr = progress(), old = pr[A.id]?.stars || 0;
  if (A.stars > old) pr[A.id] = { stars:A.stars, at:Date.now() };
  save(PKEY, pr); persist(); renderHud(); confetti();
  env.track(`done-${A.id}-${A.stars}`);
}
function leave(restore){
  A = null; save(AKEY, null); leaving = false;
  if (restore){ const b = load(BKEY, null); if (b) env.applyProject(b); toast(b ? '已還原原本的工作台。' : '沒有備份可以還原。'); }
  renderHud();
}
function hint(){
  const x = byId(A.id); if (A.hints >= x.hints.length) return;
  A.hints++; persist(); renderHud();
}
function answer(){
  const x = byId(A.id);
  for (const w of [...wires]) removeWire(w, true);
  loadWires(A.fix);
  if (x.kind === 'challenge') env.setCode(A.fix.code, false);
  env.syncWiring();
  A.answer = true; persist(); renderHud();
  toast('已經照解答接好了。接著依序按「檢測 → 編譯 → 燒錄」。');
}

/* ---------- 浮在 3D 畫面上的關卡卡片 ---------- */
function renderHud(){
  const el = $('#mh'), stage = $('#stage');
  if (!A){ el.hidden = true; stage.classList.remove('has-mh'); return; }
  const x = byId(A.id), list = listOf(x.kind), c = makeCtx(A, { running:false, serial:'' });
  el.hidden = false; stage.classList.add('has-mh'); el.classList.toggle('min', collapsed); el.classList.toggle('won', A.done);
  const tag = `${x.kind === 'mission' ? '闖關' : '故障挑戰'} ${x.no}／${list.length}`;
  const head = `<div class="mh-top"><span class="mh-tag ${x.kind}">${tag}</span><strong>${esc(x.title)}</strong><button type="button" class="mh-min" data-mh="min" aria-label="${collapsed ? '展開' : '收合'}" aria-expanded="${!collapsed}">${collapsed ? '＋' : '－'}</button></div>${A.done ? '' : `<button type="button" class="mh-next" id="mhNext" data-mh="min">${nextHtml}</button>`}`;
  if (A.done){
    const next = list[list.findIndex(y => y.id === x.id) + 1];
    el.innerHTML = `${head}<div class="mh-body"><div class="mh-win"><b>${x.kind === 'mission' ? '過關！' : '修好了！'}</b><span class="mh-stars" aria-label="${A.stars} 顆星">${starStr(A.stars)}</span></div>
      <p class="mh-learn">${esc(x.learn)}</p>
      ${A.stars < 3 ? `<p class="mh-note">${A.answer ? '看了解答：1 顆星。' : '用了提示或建議接線：2 顆星。'}再玩一次、不看提示可以拿 3 顆星。</p>` : ''}
      <div class="mh-btns">${next ? `<button class="btn sm primary" type="button" data-mh="next" data-id="${next.id}">下一關：${esc(next.title)}</button>` : ''}<button class="btn sm" type="button" data-mh="map">回到學習地圖</button><button class="btn sm ghost" type="button" data-mh="leave">結束</button></div>
      ${leaving ? leaveBox() : ''}</div>`;
    return;
  }
  const hints = Array.from({ length:A.hints }, (_, k) => `<li>${esc(hintText(x, k, c))}</li>`).join('');
  el.innerHTML = `${head}<div class="mh-body">
    ${x.kind === 'challenge' ? `<p class="mh-sym"><b>狀況</b>${esc(x.symptom)}</p><p class="mh-intro">程式已經燒好在跑了。用 3D 畫面、序列埠、接線表和「檢測」找出哪裡出錯，修好它。</p>` : `<p class="mh-intro">${esc(x.intro)}</p>`}
    <ol class="mh-steps" id="mhSteps">${lastSteps}</ol>
    ${hints ? `<ol class="mh-hints">${hints}</ol>` : ''}
    <div class="mh-btns">
      <button class="btn sm" type="button" data-mh="hint" ${A.hints >= x.hints.length ? 'disabled' : ''}>提示（${x.hints.length - A.hints}）</button>
      <button class="btn sm" type="button" data-mh="answer" ${A.answer ? 'disabled' : ''}>看解答</button>
      <button class="btn sm ghost" type="button" data-mh="map">地圖</button>
      <button class="btn sm ghost" type="button" data-mh="leave">離開</button>
    </div>
    ${leaving ? leaveBox() : ''}
    <p class="mh-score">${A.answer ? '已看解答：1 顆星' : A.hints || A.assisted ? '用了提示：最多 2 顆星' : '不看提示可以拿 3 顆星'}</p>
  </div>`;
}
const leaveBox = () => `<div class="mh-leave"><p>離開之後，工作台要怎麼辦？</p><div class="mh-btns"><button class="btn sm primary" type="button" data-mh="restore">還原原本的工作台</button><button class="btn sm" type="button" data-mh="keep">保留現在的</button><button class="btn sm ghost" type="button" data-mh="cancel">取消</button></div></div>`;
let nextHtml = '';
function renderSteps(steps){
  const html = steps.map(s => `<li class="${s.ok ? 'ok' : ''}"><i aria-hidden="true">${s.ok ? '✓' : ''}</i><span>${esc(s.text)}</span><em class="sr">${s.ok ? '（完成）' : '（還沒完成）'}</em></li>`).join('');
  const k = steps.findIndex(s => !s.ok), nh = k < 0 ? '' : `<b>${steps.filter(s => s.ok).length}／${steps.length}</b>下一步：${esc(steps[k].text)}`;
  if (nh !== nextHtml){ nextHtml = nh; const n = $('#mhNext'); if (n) n.innerHTML = nh; }
  if (html === lastSteps) return;
  lastSteps = html; const el = $('#mhSteps'); if (el) el.innerHTML = html;
}
function confetti(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
  const colors = ['#ff6b35', '#ffd166', '#3ddc84', '#5fd3f3', '#ff7ad9'];
  for (let i = 0; i < 28; i++){ const s = document.createElement('i'); s.style.left = `${Math.random() * 100}%`; s.style.background = colors[i % colors.length]; s.style.animationDelay = `${Math.random() * .25}s`; s.style.setProperty('--dx', `${(Math.random() - .5) * 120}px`); box.appendChild(s); }
  $('#stage').appendChild(box); setTimeout(() => box.remove(), 1800);
}

/* ---------- 學習地圖 ---------- */
function openMap(){ $('#lm').hidden = false; document.body.classList.add('la-open'); renderMap(); env.track('map'); }
function closeMap(){ $('#lm').hidden = true; document.body.classList.remove('la-open'); }
function renderMap(){
  const pr = progress(), all = [...MISSIONS, ...CHALLENGES], done = all.filter(x => pr[x.id]).length, stars = all.reduce((s, x) => s + (pr[x.id]?.stars || 0), 0);
  $('#lmSub').textContent = `完成 ${done}／${all.length} 關 · ★ ${stars}／${all.length * 3}`;
  document.querySelectorAll('#lm .lm-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const b = bench.board, list = listOf(tab);
  const mods = x => [...new Set(x.mods.map(m => MODULE_TYPES[m.type].short))].map(s => `<span>${esc(s)}</span>`).join('');
  $('#lmBody').innerHTML = `<p class="note">${tab === 'mission' ? '照順序闖關：程式已經寫好，你要讀懂程式、自己接線，再完成任務。每一步都會自動打勾。' : '程式已經燒好在跑，可是有地方錯了。看症狀、找原因、修好它——就像實驗室裡真的會遇到的狀況。'}
    使用目前的開發板（${esc(b.name)}）${list.some(x => !boardFits(b, x)) ? `；這塊板子沒有某些關卡需要的功能時，會換成 ${esc(BOARD_BY_ID[DEFAULT_BOARD].name)}` : ''}。開始一關會換掉目前的工作台（會先自動備份，離開時可以還原）。</p>
    <div class="lm-grid">${list.map(x => { const s = pr[x.id]?.stars || 0, cur = A && A.id === x.id; return `<article class="lm-card ${s ? 'done' : ''} ${cur ? 'cur' : ''}">
      <div class="lm-no" aria-hidden="true">${x.no}</div>
      <div class="lm-main"><h3>${esc(x.title)}</h3><p>${esc(x.kind === 'challenge' || tab === 'challenge' ? x.symptom : x.short)}</p><div class="lm-mods">${mods(x)}</div></div>
      <div class="lm-side"><span class="lm-stars" aria-label="${s ? `${s} 顆星` : '還沒完成'}">${s ? starStr(s) : '☆☆☆'}</span><button class="btn sm ${cur ? '' : 'primary'}" type="button" data-start="${x.id}">${cur ? '繼續' : s ? '再玩一次' : '開始'}</button></div>
    </article>`; }).join('')}</div>
    <div class="lm-foot">${CONFIG.signupUrl ? `<a class="btn sm" href="${esc(CONFIG.signupUrl)}" target="_blank" rel="noopener">有新關卡時通知我</a>` : ''}<span class="note">進度存在這台裝置的瀏覽器裡。</span></div>`;
}

const ctxNow = () => makeCtx(A, { running:env.running(), serial, reflashed:env.flashSeq() > A.seq0 });
export function initLearn(e){
  env = e;
  // GPIO 每次改變都通知這一關（LED 閃爍、蜂鳴器響的次數用邊緣計數，不會因為畫面慢而漏掉）
  pinListeners.push((pin, v) => { if (!A || A.done) return; const x = byId(A.id); if (x?.edge){ try { x.edge(ctxNow(), pin, v); } catch (_){ /* 模組被移除時略過 */ } } });
  setInterval(learnTick, 200);                            // 判定不跟著畫面更新率：3D 很慢的裝置也一樣準
  $('#btnLearn').addEventListener('click', openMap);
  $('#lmClose').addEventListener('click', closeMap);
  document.addEventListener('keydown', ev => { if (!$('#lm').hidden && ev.key === 'Escape') closeMap(); });
  document.querySelector('#lm .lm-tabs').addEventListener('click', ev => { const b = ev.target.closest('button[data-tab]'); if (b){ tab = b.dataset.tab; renderMap(); } });
  $('#lmBody').addEventListener('click', ev => { const b = ev.target.closest('[data-start]'); if (!b) return; if (A && A.id === b.dataset.start){ closeMap(); collapsed = false; renderHud(); } else start(b.dataset.start); });
  $('#mh').addEventListener('click', ev => {
    const b = ev.target.closest('[data-mh]'); if (!b || b.disabled) return;
    const k = b.dataset.mh;
    if (k === 'min'){ collapsed = !collapsed; renderHud(); }
    else if (k === 'hint') hint();
    else if (k === 'answer') answer();
    else if (k === 'map'){ tab = A ? A.kind : tab; openMap(); }
    else if (k === 'next') start(b.dataset.id);
    else if (k === 'leave'){ leaving = true; renderHud(); }
    else if (k === 'cancel'){ leaving = false; renderHud(); }
    else if (k === 'restore') leave(true);
    else if (k === 'keep') leave(false);
  });
  // 重新整理頁面（或 iPhone 把分頁從記憶體移除）後，繼續剛才的關卡
  const a = e.shared ? null : load(AKEY, null);
  if (e.shared) save(AKEY, null);
  if (a && byId(a.id)){ A = { ...a, seq0:-1, cnt:{}, v:{}, flag:{} }; collapsed = matchMedia('(max-width: 760px)').matches; renderHud(); learnTick(); }
}
