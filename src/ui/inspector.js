// 「元件」分頁：開發板、板上元件、外接模組的資訊、datasheet、更換型號與互動控制
import { $, esc } from './dom.js';
import { BOARDS, SERIES_ORDER, FORMS, boardParts, fmtKB } from '../core/boards.js';
import { MODULE_TYPES, TYPE_ORDER, variantOf, MAX_MODULES } from '../core/parts.js';
import { bench, SIM, moduleLabel, moduleById, moduleState, sensorTemp, supply } from '../core/sim.js';

const GRADE = ['', '入門', '進階', '高階'];
const RH_DEV = ['sht3x', 'aht20', 'hdc1080'];
export const insp = { view:'overview', id:null, q:'', series:'all' };
let act = {};

const link = l => `<a class="dl" href="${esc(l.url)}" target="_blank" rel="noopener"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>${esc(l.label)}</a>`;
const links = ls => ls.length ? `<div class="dls">${ls.map(link).join('')}</div>` : '';
const back = `<button class="btn sm ghost back" data-act="overview" type="button">← 全部元件</button>`;
const gradeTag = g => `<span class="grade g${g}">${GRADE[g]}</span>`;
const specTable = rows => `<dl class="specs">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;

function boardSpecs(b){
  return [['MCU', b.mcu], ['核心', `${b.core} · ${b.mhz} MHz`], ['Flash／RAM', `${fmtKB(b.flash)}／${fmtKB(b.ram)}`], ['封裝', b.pkg], ['板型', FORMS[b.form].name],
    ['燒錄器', b.prog], ['板載 LED', b.leds.map(l => `${l.name} ${l.pin}`).join('、')], ['使用者按鈕', b.btn ? `${b.btn.name} ${b.btn.pin}${b.btn.activeLow ? '（低電位有效）' : ''}` : '無'],
    ['I2C', `${b.i2c.bus}：SCL ${b.i2c.scl}、SDA ${b.i2c.sda}`], ['printf 輸出', `${b.vcp.periph}（${b.vcp.tx}/${b.vcp.rx}）`], ['Device ID', b.devId]];
}

function overview(){
  const b = bench.board, parts = boardParts(b), mods = bench.modules;
  return `
  <section class="insp-sec">
    <div class="row-head"><span class="eyebrow">開發板</span><button class="btn sm primary" data-act="boards" type="button">更換開發板</button></div>
    <button class="bcard" data-act="part" data-id="mcu" type="button">
      <strong>${esc(b.name)}</strong>
      <span class="mono">${esc(b.mcu)}</span>
      <span class="chipline"><i>${esc(b.core)}</i><i>${b.mhz} MHz</i><i>Flash ${fmtKB(b.flash)}</i><i>RAM ${fmtKB(b.ram)}</i><i>${b.header.length} 腳排針</i></span>
    </button>
    ${links(b.links)}
  </section>
  <section class="insp-sec">
    <span class="eyebrow">板上元件</span>
    <ul class="plist">${parts.map(p => `<li><button data-act="part" data-id="${p.key}" type="button"><span><strong>${esc(p.name)}</strong><small>${esc(p.part)}</small></span><span class="go">›</span></button></li>`).join('')}</ul>
  </section>
  <section class="insp-sec">
    <span class="eyebrow">外接模組 ${mods.length}／${MAX_MODULES}</span>
    <ul class="plist">${mods.map(m => { const v = variantOf(m.type, m.variant); return `<li><button data-act="module" data-id="${m.id}" type="button"><span><strong>${esc(moduleLabel(m))}</strong><small>${esc(v.name)} · ${esc(v.part)}</small></span>${gradeTag(v.grade)}<span class="go">›</span></button></li>`; }).join('') || '<li class="empty">還沒有外接模組，從下面新增。</li>'}</ul>
    <span class="eyebrow">新增模組</span>
    <div class="addgrid">${TYPE_ORDER.map(t => `<button class="btn sm" data-act="add" data-type="${t}" type="button" ${mods.length >= MAX_MODULES ? 'disabled' : ''}>＋ ${esc(MODULE_TYPES[t].name)}</button>`).join('')}</div>
    ${mods.length >= MAX_MODULES ? '<p class="note">工作台最多放 8 個模組，先移除一個再新增。</p>' : ''}
  </section>`;
}

function boardsView(){
  const q = insp.q.trim().toLowerCase(), cur = bench.board.id;
  const shown = BOARDS.filter(b => (insp.series === 'all' || b.series === insp.series) && (!q || `${b.name} ${b.mcu} ${b.core}`.toLowerCase().includes(q)));
  const series = SERIES_ORDER.filter(s => BOARDS.some(b => b.series === s));
  const groups = series.map(s => [s, shown.filter(b => b.series === s)]).filter(([, l]) => l.length);
  return `${back}
  <section class="insp-sec">
    <h2>更換開發板（共 ${BOARDS.length} 塊）</h2>
    <p class="note">切換後，接在新板子上不存在的腳位的線會自動拔除，Flash 會是空白的。Nucleo 系列使用 Arduino 相容的 A0–A5、D0–D15 腳位名稱，換成同系列的板子時接線大多可以保留。</p>
    <input class="search" id="boardQuery" type="search" placeholder="搜尋型號，例如 F401、H7、M0+" value="${esc(insp.q)}" aria-label="搜尋開發板">
    <div class="chips seriesf">${['all', ...series].map(s => `<button class="chip ${insp.series === s ? 'hi' : ''}" data-act="series" data-id="${s}" type="button">${s === 'all' ? '全部' : 'STM32' + s}</button>`).join('')}</div>
    ${groups.map(([s, l]) => `<div class="bgroup"><span class="eyebrow">STM32${s}</span><ul class="plist">${l.map(b => `<li><button data-act="pick" data-id="${b.id}" type="button" class="${b.id === cur ? 'cur' : ''}"><span><strong>${esc(b.name)}</strong><small>${esc(b.mcu)} · ${esc(b.core)} ${b.mhz} MHz · ${fmtKB(b.flash)}／${fmtKB(b.ram)}</small></span>${b.id === cur ? '<span class="grade g3">使用中</span>' : '<span class="go">›</span>'}</button></li>`).join('')}</ul></div>`).join('') || '<p class="empty">找不到符合的開發板。</p>'}
  </section>`;
}

function partView(key){
  const b = bench.board, p = boardParts(b).find(x => x.key === key); if (!p) return overview();
  return `${back}
  <section class="insp-sec">
    <span class="eyebrow">${esc(p.name)}</span>
    <h2 class="ptitle">${esc(p.part)}</h2>
    <p class="note">${esc(p.desc)}</p>
    ${key === 'mcu' ? specTable(boardSpecs(b)) : ''}
    ${links(key === 'mcu' ? b.links : p.links)}
    ${key === 'mcu' ? '<button class="btn primary" data-act="boards" type="button">更換開發板</button>' : ''}
  </section>`;
}

function controls(m, v){
  const s = m.st;
  if (m.type === 'pot'){
    const label = v.kind === 'ldr' ? '光線強度' : v.kind === 'slide' ? '滑桿位置' : '旋鈕位置';
    return `<label class="ctl" for="potRange">${label}<input type="range" id="potRange" min="0" max="100" value="${Math.round(s.pot * 100)}"><output id="potOut">${Math.round(s.pot * 100)}%</output></label>`;
  }
  if (m.type === 'temp') return `
    <label class="ctl" for="ambT">環境溫度<input type="range" id="ambT" min="0" max="45" step="0.5" value="${SIM.ambient.T}"><output id="ambTOut">${SIM.ambient.T.toFixed(1)} °C</output></label>
    ${RH_DEV.includes(v.dev) ? `<label class="ctl" for="ambRH">環境溼度<input type="range" id="ambRH" min="10" max="95" value="${SIM.ambient.RH}"><output id="ambRHOut">${SIM.ambient.RH} %</output></label>` : ''}
    <button class="btn sm" data-act="warm" type="button">用手指按住感測器（加溫）</button>`;
  if (m.type === 'pir') return `<button class="btn sm" data-act="motion" type="button">模擬有人經過</button>`;
  if (m.type === 'button') return `<button class="btn sm" id="holdBtn" type="button">按住這裡＝按下按鈕</button>`;
  return '';
}

function moduleView(id){
  const m = moduleById(id); if (!m) return overview();
  const T = MODULE_TYPES[m.type], v = variantOf(m.type, m.variant);
  return `${back}
  <section class="insp-sec">
    <span class="eyebrow">${esc(moduleLabel(m))} · ${esc(T.name)}</span>
    <h2 class="ptitle">${esc(v.name)} ${gradeTag(v.grade)}</h2>
    <p class="mono note">${esc(v.part)}</p>
    ${specTable([...v.specs, ['腳位', T.pins.map(p => p[0]).join('、')]])}
    ${links(v.links)}
    <div class="live" id="inspLive"></div>
    ${controls(m, v)}
  </section>
  <section class="insp-sec">
    <span class="eyebrow">更換型號</span>
    <ul class="plist vlist">${T.variants.map(x => `<li><button data-act="variant" data-id="${x.id}" type="button" class="${x.id === v.id ? 'cur' : ''}"><span><strong>${esc(x.name)}</strong><small>${esc(x.part)}${x.better && x.grade > v.grade ? ` · <b class="up">升級：${esc(x.better)}</b>` : ''}</small></span>${x.id === v.id ? '<span class="grade g3">使用中</span>' : gradeTag(x.grade)}</button></li>`).join('')}</ul>
    <p class="note">更換型號會保留原本的接線。程式若是範例程式，會自動改成新型號的讀取方式。</p>
    <button class="btn sm danger" data-act="remove" type="button">移除這個模組</button>
  </section>`;
}

export function renderInspector(){
  const el = $('#inspector'); if (!el) return;
  el.innerHTML = insp.view === 'boards' ? boardsView() : insp.view === 'part' ? partView(insp.id) : insp.view === 'module' ? moduleView(insp.id) : overview();
  updateLive();
}
export function showInspector(view, id){ insp.view = view; insp.id = id ?? null; renderInspector(); const p = $('#tab-parts'); if (p) p.scrollTop = 0; }

/** 模組詳細頁的即時狀態 */
export function updateLive(){
  const el = $('#inspLive'); if (!el || insp.view !== 'module') return;
  const m = moduleById(insp.id); if (!m) return;
  const s = moduleState(m), v = variantOf(m.type, m.variant); let t = '';
  if (m.type === 'led') t = s.on ? '目前：亮' : '目前：熄滅';
  if (m.type === 'rgb') t = `目前：R ${s.r ? '亮' : '熄'}、G ${s.g ? '亮' : '熄'}、B ${s.b ? '亮' : '熄'}`;
  if (m.type === 'buzzer') t = s.on ? '目前：發聲中' : '目前：安靜';
  if (m.type === 'relay') t = s.weak ? '線圈電壓不足，吸不動' : s.on ? '目前：吸合（接點導通）' : '目前：斷開';
  if (m.type === 'pir') t = s.active ? '目前：偵測到人（OUT 高電位）' : '目前：無人';
  if (m.type === 'button') t = s.pressed ? '目前：按下' : '目前：放開';
  if (m.type === 'pot'){ const vcc = supply(`${m.id}.VCC`); t = vcc ? `輸出電壓約 ${(vcc * m.st.pot).toFixed(2)} V` : '沒有供電'; }
  if (m.type === 'temp') t = s.damaged ? '已損壞，請在「檢測」分頁更換' : s.ok ? `感測器讀值約 ${sensorTemp(m).toFixed(2)} °C（${v.part} 的誤差已包含在內）` : '目前沒有連上 I2C 匯流排';
  el.textContent = t;
}

export function initInspector(actions){
  act = actions;
  const el = $('#inspector');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const id = b.dataset.id;
    switch (b.dataset.act){
      case 'overview': showInspector('overview'); break;
      case 'boards': showInspector('boards'); break;
      case 'part': showInspector('part', id); act.focusPart?.(id); break;
      case 'module': showInspector('module', id); act.focusModule?.(id); break;
      case 'series': insp.series = id; renderInspector(); break;
      case 'pick': act.changeBoard(id); break;
      case 'variant': act.setVariant(insp.id, id); break;
      case 'remove': act.removeModule(insp.id); break;
      case 'add': act.addModule(b.dataset.type); break;
      case 'warm': act.warm(insp.id); break;
      case 'motion': act.motion(insp.id); break;
    }
  });
  el.addEventListener('input', e => {
    if (e.target.id === 'boardQuery'){ insp.q = e.target.value; const pos = e.target.selectionStart; renderInspector(); const q = $('#boardQuery'); q.focus(); q.setSelectionRange(pos, pos); }
    if (e.target.id === 'potRange'){ const v = +e.target.value / 100; $('#potOut').textContent = e.target.value + '%'; act.setPot(insp.id, v); }
    if (e.target.id === 'ambT'){ SIM.ambient.T = +e.target.value; $('#ambTOut').textContent = SIM.ambient.T.toFixed(1) + ' °C'; act.changed(); }
    if (e.target.id === 'ambRH'){ SIM.ambient.RH = +e.target.value; $('#ambRHOut').textContent = SIM.ambient.RH + ' %'; act.changed(); }
  });
  const hold = (down, e) => { if (e.target.id !== 'holdBtn') return; e.preventDefault(); if (down) try { e.target.setPointerCapture(e.pointerId); } catch (_){} act.press(insp.id, down); };
  el.addEventListener('pointerdown', e => hold(true, e));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, e => hold(false, e), true);
}
