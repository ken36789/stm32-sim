// 「元件」分頁：開發板、板上元件、外接模組的資訊、datasheet、更換型號與互動控制
import { $, esc } from './dom.js';
import { BOARDS, VENDORS, seriesLabel, FORMS, boardParts, fmtKB } from '../core/boards.js';
import { SDK_NAMES } from '../core/sdk.js';
import { MODULE_TYPES, MODULE_GROUPS, variantOf, MAX_MODULES } from '../core/parts.js';
import { bench, SIM, moduleLabel, moduleById, moduleState, sensorTemp, supply, isAnalyzer } from '../core/sim.js';
import { tcTemp, canLink, nodeOfCan, spiDevices, CAN } from '../core/buses.js';
import { probeSource, probeOk } from '../core/analyzer.js';
import { USTEP, LOADS, ustepName, dmodeBits, motorOf, motorInfo, drvOf, drvStatus, motorOfDriver, divSource, coilMap, FAULTS, VREF_GAIN } from '../core/steppers.js';
import { pinTable, wiringSvg } from './tb67guide.js';
import { moduleSupport, needOf, FEATURES } from '../core/support.js';

const GRADE = ['', '入門', '進階', '高階'];
const RH_DEV = ['sht3x', 'aht20', 'hdc1080'];
export const insp = { view:'overview', id:null, q:'', vendor:'all' };
const kindTag = b => b.kind === 'official' ? '<span class="grade g3">官方開發板</span>' : '<span class="grade g1">通用評估板</span>';
let act = {};

const link = l => `<a class="dl" href="${esc(l.url)}" target="_blank" rel="noopener"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>${esc(l.label)}</a>`;
const links = ls => ls.length ? `<div class="dls">${ls.map(link).join('')}</div>` : '';
const back = `<button class="btn sm ghost back" data-act="overview" type="button">← 全部元件</button>`;
const gradeTag = g => `<span class="grade g${g}">${GRADE[g]}</span>`;
const specTable = rows => `<dl class="specs">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;

/* ---- 這塊板子不能用的模組：灰色按鈕＋原因＋可以改用的板子 ---- */
const altBtns = alt => alt.length ? `<span class="alts"><span>可以改用</span>${alt.map(x => `<button class="btn sm" data-act="pick" data-id="${x.id}" type="button">換成 ${esc(x.name)}</button>`).join('')}</span>` : '';
function addBtn(t, full){
  const s = moduleSupport(t), name = esc(MODULE_TYPES[t].name);
  return s.ok ? `<button class="btn sm" data-act="add" data-type="${t}" type="button" ${full ? 'disabled' : ''}>＋ ${name}</button>`
    : `<button class="btn sm off" data-act="add" data-type="${t}" type="button" aria-disabled="true"><span>${name}</span><em>${esc(s.lack)}</em></button>`;
}
/** 同一組裡因為同一個原因不能用的模組合併成一段說明 */
function groupNotes(types){
  const by = new Map();
  for (const t of types){
    const s = moduleSupport(t); if (s.ok && !s.note) continue;
    const k = s.ok ? 'ok:' + t : s.feat; if (!by.has(k)) by.set(k, { s, names:[] }); by.get(k).names.push(MODULE_TYPES[t].name);
  }
  return [...by.values()].map(({ s, names }) => s.ok
    ? `<p class="nosup part"><b>${esc(names.join('、'))}</b>可以用，但${esc(s.note)}</p>`
    : `<div class="nosup"><p><b>${esc(names.join('、'))}</b>不能用：${esc(s.why)}${esc(s.tip)}</p>${altBtns(s.alt)}</div>`).join('');
}

function boardSpecs(b){
  return [['廠牌', VENDORS.find(v => v.id === b.vendor).name], ['MCU', b.mcu], ['核心', `${b.core} · ${b.mhz} MHz`], ['SDK', SDK_NAMES[b.sdk]], ['Flash／RAM', `${fmtKB(b.flash)}／${fmtKB(b.ram)}`], ['封裝', b.pkg], ['板型', FORMS[b.form].name],
    ['燒錄器', b.prog], ['板載 LED', b.leds.map(l => `${l.name} ${l.pin}`).join('、')], ['使用者按鈕', b.btn ? `${b.btn.name} ${b.btn.pin}${b.btn.activeLow ? '（低電位有效）' : ''}` : '無'],
    ['I2C', `${b.i2c.bus}：SCL ${b.i2c.scl}、SDA ${b.i2c.sda}`], ['SPI', b.spi ? `${b.spi.bus}：SCK ${b.spi.sck}、MISO ${b.spi.miso}、MOSI ${b.spi.mosi}` : '無（' + (b.noSpi || '') + '）'],
    ['CAN', b.can ? `${b.can.bus}：TX ${b.can.tx}、RX ${b.can.rx}` : b.noCan || '無'], ['printf 輸出', `${b.vcp.periph}（${b.vcp.tx}/${b.vcp.rx}）`], ['Device ID', b.devId]];
}

function overview(){
  const b = bench.board, parts = boardParts(b), mods = bench.modules;
  return `
  <section class="insp-sec">
    <div class="row-head"><span class="eyebrow">開發板</span><button class="btn sm primary" data-act="boards" type="button">更換晶片／開發板</button></div>
    <button class="bcard" data-act="part" data-id="mcu" type="button">
      <strong>${esc(b.name)} ${kindTag(b)}</strong>
      <span class="mono">${esc(b.mcu)} · ${esc(SDK_NAMES[b.sdk])}</span>
      <span class="chipline"><i>${esc(b.core)}</i><i>${b.mhz} MHz</i><i>Flash ${fmtKB(b.flash)}</i><i>RAM ${fmtKB(b.ram)}</i><i>${b.header.length} 腳排針</i></span>
    </button>
    ${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
    ${links(b.links)}
  </section>
  <section class="insp-sec">
    <span class="eyebrow">板上元件</span>
    <ul class="plist">${parts.map(p => `<li><button data-act="part" data-id="${p.key}" type="button"><span><strong>${esc(p.name)}</strong><small>${esc(p.part)}</small></span><span class="go">›</span></button></li>`).join('')}</ul>
  </section>
  <section class="insp-sec">
    <span class="eyebrow">外接模組 ${mods.length}／${MAX_MODULES}</span>
    <ul class="plist">${mods.map(m => { const v = variantOf(m.type, m.variant), s = moduleSupport(m.type); return `<li${s.ok ? '' : ' class="off"'}><button data-act="module" data-id="${m.id}" type="button"><span><strong>${esc(moduleLabel(m))}</strong><small>${s.ok ? `${esc(v.name)} · ${esc(v.part)}` : `${esc(MODULE_TYPES[m.type].name)} · ${esc(s.lack)}，這塊板子不能用`}</small></span>${s.ok ? gradeTag(v.grade) : '<span class="grade g0">不支援</span>'}<span class="go">›</span></button></li>`; }).join('') || '<li class="empty">還沒有外接模組，從下面新增。</li>'}</ul>
    <span class="eyebrow">新增模組</span>
    ${MODULE_GROUPS.map(([g, types]) => `<div class="addgroup"><small>${esc(g)}</small><div class="addgrid">${types.map(t => addBtn(t, mods.length >= MAX_MODULES)).join('')}</div>${groupNotes(types)}</div>`).join('')}
    ${mods.length >= MAX_MODULES ? `<p class="note">工作台最多放 ${MAX_MODULES} 個模組，先移除一個再新增。</p>` : ''}
  </section>`;
}

function boardsView(){
  const q = insp.q.trim().toLowerCase(), cur = bench.board.id;
  const shown = BOARDS.filter(b => (insp.vendor === 'all' || b.vendor === insp.vendor) && (!q || `${b.name} ${b.mcu} ${b.core} ${b.series} ${b.vendor}`.toLowerCase().includes(q)));
  const groups = VENDORS.flatMap(v => v.series.map(s => [v, s, shown.filter(b => b.vendor === v.id && b.series === s)])).filter(([, , l]) => l.length);
  const count = id => BOARDS.filter(b => b.vendor === id).length;
  // 目前工作台上的模組需要的周邊：換到沒有這個周邊的板子時，那些模組會變灰色
  const needs = [...new Set(bench.modules.map(m => needOf(m.type)).filter(Boolean))];
  const lackOf = x => { const fs = needs.filter(f => !x[f]); if (!fs.length) return '';
    const names = [...new Set(bench.modules.filter(m => fs.includes(needOf(m.type))).map(m => MODULE_TYPES[m.type].name))];
    return `<em class="lack">${fs.map(f => FEATURES[f].lack).join('、')}：${esc(names.join('、'))}會變灰色</em>`; };
  return `${back}
  <section class="insp-sec">
    <h2>更換晶片／開發板（共 ${BOARDS.length} 種）</h2>
    <p class="note">切換後，接在新板子上不存在的腳位的線會自動拔除，Flash 是空白的。每家晶片使用自己原廠 SDK 的寫法：ST 用 STM32Cube HAL，TI 用 DriverLib／TivaWare／C2000Ware，NXP 用 MCUXpresso SDK。「載入範例程式」會產生對應的寫法。</p>
    <input class="search" id="boardQuery" type="search" placeholder="搜尋型號，例如 F401、MSP430、K64、RT1060" value="${esc(insp.q)}" aria-label="搜尋晶片或開發板">
    <div class="chips seriesf">${[['all', `全部 ${BOARDS.length}`], ...VENDORS.map(v => [v.id, `${v.id} ${count(v.id)}`])].map(([id, l]) => `<button class="chip ${insp.vendor === id ? 'hi' : ''}" data-act="vendor" data-id="${id}" type="button">${l}</button>`).join('')}</div>
    ${groups.map(([v, s, l]) => `<div class="bgroup"><span class="eyebrow">${esc(v.id)} · ${esc(seriesLabel(v.id, s))}</span><ul class="plist">${l.map(b => `<li><button data-act="pick" data-id="${b.id}" type="button" class="${b.id === cur ? 'cur' : ''}"><span><strong>${esc(b.name)}</strong><small>${esc(b.mcu)} · ${esc(b.core)} ${b.mhz} MHz · ${fmtKB(b.flash)}／${fmtKB(b.ram)}${lackOf(b)}</small></span>${b.id === cur ? '<span class="grade g3">使用中</span>' : b.kind === 'official' ? '<span class="grade g2">官方板</span>' : '<span class="go">›</span>'}</button></li>`).join('')}</ul></div>`).join('') || '<p class="empty">找不到符合的晶片。</p>'}
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
  if (isAnalyzer(m)) return `<button class="btn primary la-open" data-act="analyzer" type="button">打開邏輯分析儀（波形、解說、教學）</button>`;
  if (m.type === 'tc'){
    const t = Math.round(s.tcT ?? SIM.ambient.T);
    return `<label class="ctl" for="tcT">熱電偶溫度<input type="range" id="tcT" min="${v.dev === 'max31855' ? -50 : 0}" max="400" value="${t}"><output id="tcTOut">${t} °C</output></label>
      <label class="ctl" for="tcOpen" style="grid-template-columns:auto 1fr">熱電偶斷線<input type="checkbox" id="tcOpen" ${s.open ? 'checked' : ''} style="width:auto;justify-self:start"></label>`;
  }
  if (m.type === 'tb67'){
    const ds = drvOf(m), src = divSource(m), mot = motorOfDriver(m), a = (ds.vref * VREF_GAIN).toFixed(2);
    return `<label class="ctl" for="stVref">VREF<input type="range" id="stVref" min="0.2" max="2" step="0.02" value="${ds.vref}"><output id="stVrefOut">${ds.vref.toFixed(2)} V</output></label>
      <p class="note" id="stVrefNote" style="margin-top:-4px">電流限制 ＝ VREF × 1.56 ＝ <b>${a} A</b>${mot ? `（${esc(moduleLabel(mot))} 額定 ${variantOf(mot.type, mot.variant).rated} A）` : ''}。用螺絲起子轉板上的藍色可變電阻；最好在接馬達之前先調好。</p>
      <label class="ctl" for="stJdiv" style="grid-template-columns:auto 1fr">MODE 跳線<select id="stJdiv" ${src.can ? '' : 'disabled'}>${USTEP.map(d => `<option value="${d}" ${d === src.div ? 'selected' : ''}>${ustepName(d)} · MODE2..0 ${dmodeBits(d)}</option>`).join('')}</select></label>
      <p class="note" style="margin-top:-4px">${esc(src.how)}。</p>
      ${mot ? '<button class="btn primary la-open" data-act="stepper" type="button">打開步進馬達示波器（波形、加減速、微步比較）</button>' : ''}`;
  }
  if (m.type === 'psu'){ const on = m.st.on !== false; return `<button class="btn sm ${on ? '' : 'primary'}" data-act="psu" type="button">${on ? '關閉電源開關' : '打開電源開關'}</button><p class="note">建議：接線、插拔馬達線時先關電源，接好再打開。關掉再打開也會清除驅動板鎖住的錯誤。</p>`; }
  if (m.type === 'motor'){
    const mo = motorOf(m), src = divSource(m);
    return `<label class="ctl" for="stLoad" style="grid-template-columns:auto 1fr">負載<select id="stLoad">${LOADS.map(l => `<option value="${l.id}" ${l.id === mo.load ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <p class="note">微步：${ustepName(src.div)}（${esc(src.how)}）。</p>
      <button class="btn primary la-open" data-act="stepper" type="button">打開步進馬達示波器（波形、加減速、微步比較）</button>`;
  }
  if (m.type === 'stepper'){
    const mo = motorOf(m);
    return `<label class="ctl" for="stDiv" style="grid-template-columns:auto 1fr">微步（DMODE）<select id="stDiv">${USTEP.map(d => `<option value="${d}" ${d === mo.jdiv ? 'selected' : ''}>${ustepName(d)} · DMODE ${dmodeBits(d)}</option>`).join('')}</select></label>
      <label class="ctl" for="stLoad" style="grid-template-columns:auto 1fr">負載<select id="stLoad">${LOADS.map(l => `<option value="${l.id}" ${l.id === mo.load ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <button class="btn primary la-open" data-act="stepper" type="button">打開步進馬達示波器（波形、加減速、微步比較）</button>`;
  }
  if (m.type === 'flash') return `<button class="btn sm" data-act="erase" type="button">整顆抹除（全部變成 0xFF）</button>`;
  if (m.type === 'can'){ const on = nodeOfCan(m).on; return `<button class="btn sm ${on ? '' : 'primary'}" data-act="node" type="button">${on ? '關閉測試節點（看 ACK 錯誤）' : '開啟測試節點'}</button>`; }
  return '';
}

function moduleView(id){
  const m = moduleById(id); if (!m) return overview();
  const T = MODULE_TYPES[m.type], v = variantOf(m.type, m.variant), s = moduleSupport(m.type);
  return `${back}
  <section class="insp-sec">
    <span class="eyebrow">${esc(moduleLabel(m))} · ${esc(T.name)}</span>
    ${s.ok ? '' : `<div class="nosup big" role="note"><strong>${esc(bench.board.name)} 不能用這個模組（${esc(s.lack)}）</strong><p>${esc(s.why)}${esc(s.tip)}</p>${altBtns(s.alt)}<p class="note">模組變成灰色：「建議接線」不會接它，通電後也不會動作。換成有這個功能的開發板，它就會恢復。</p></div>`}
    <h2 class="ptitle">${esc(v.name)} ${gradeTag(v.grade)}</h2>
    <p class="mono note">${esc(v.part)}</p>
    ${s.note ? `<p class="nosup part">${esc(s.note)}</p>` : ''}
    ${specTable([...v.specs, ['腳位', T.pins.map(p => p[0]).join('、')]])}
    ${links(v.links)}
    ${s.ok ? `<div class="live" id="inspLive"></div>
    ${controls(m, v)}` : ''}
  </section>
  ${m.type === 'tb67' ? `<section class="insp-sec"><span class="eyebrow">接線圖（依目前的接線）</span>${wiringSvg(m)}</section>
  <section class="insp-sec"><span class="eyebrow">每一支腳怎麼接</span>${pinTable(m)}</section>` : ''}
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
  if (isAnalyzer(m)){
    const T = MODULE_TYPES[m.type];
    t = T.pins.filter(([n]) => n !== 'GND').map(([n]) => { const src = probeSource(m, n); return `${n} 探棒：${src.label}${src.kind === 'line' && !probeOk(m, n) ? '（不是預期的線）' : ''}`; }).join('\n') + `\n取樣率最高 ${v.rate / 1e6} MS/s`;
  }
  if (m.type === 'tc') t = spiDevices().some(d => d.m === m) ? (m.st.open ? '熱電偶斷線：讀到的資料會帶故障旗標' : `熱電偶溫度約 ${tcTemp(m).toFixed(2)} °C`) : '目前沒有連上 SPI 匯流排（檢查電源與 SCK／SO 接線）';
  if (m.type === 'flash'){
    const mem = m.st.mem, bytes = Array.from({ length:16 }, (_, i) => (mem && mem.has(i)) ? mem.get(i) : 0xFF);
    t = `${spiDevices().some(d => d.m === m) ? '已連上 SPI 匯流排' : '目前沒有連上 SPI 匯流排'}\n位址 0x000000：${bytes.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ')}\n（Flash 斷電後資料仍然保留）`;
  }
  if (m.type === 'tb67'){
    const st = drvStatus(m), ds = drvOf(m), mot = motorOfDriver(m);
    t = st.damaged ? '已燒毀：邏輯腳接到了超過 5.5 V 的電壓' : ds.fault ? `錯誤：${FAULTS[ds.fault].name}（${FAULTS[ds.fault].lo}）\n${FAULTS[ds.fault].why}\n清除：STANDBY 拉低再拉高，或關掉馬達電源再打開` : !st.vm ? 'VIN 沒有電：接馬達電源的 V+／V−' : !st.vmOk ? `VIN 只有 ${st.vm} V：低於 6.5 V，低電壓保護關閉輸出` : !st.gndMcu ? '沒有和 MCU 共地：看不到 STEP／DIR 訊號' : !st.stby ? 'STANDBY 是低電位：待機中' : !st.en ? 'ENABLE 是低電位：輸出關閉（馬達沒有出力）' : st.rst ? 'RESET 是高電位：電氣角固定在 45°，忽略 STEP' : !mot ? 'ENABLE 打開但沒有接馬達' : '運作中：線圈有電流';
    t += `\nVIN ${st.vm} V · 電流限制 ${st.ilim.toFixed(2)} A · 晶片 ${ds.temp.toFixed(0)} °C${ds.temp > 120 ? '（很燙）' : ''}\nSTBY ${st.stby ? 'H' : 'L'} · EN ${st.en ? 'H' : 'L'} · RST ${st.rst ? 'H' : 'L'} · DIR ${st.dir > 0 ? 'H（順時針）' : 'L（逆時針）'} · ${ustepName(st.div)}`;
  }
  if (m.type === 'psu'){
    const on = m.st.on !== false, drvs = bench.modules.filter(d => d.type === 'tb67' && drvStatus(d).vm > 0);
    t = `${on ? '開' : '關'} · 輸出 ${on ? v.v : 0} V${drvs.length ? `\n供電給 ${drvs.map(moduleLabel).join('、')}` : '\n還沒有供電給驅動板（V+ → VIN、V− → PGND）'}`;
  }
  if (m.type === 'motor'){
    const i = motorInfo(m), cm = coilMap(m);
    t = !cm.drv ? '沒有接到驅動板（A+／A−／B+／B− 接驅動板右側）' : !cm.ok ? `線圈接法有問題（${cm.bad === 'open' ? '有線沒接' : cm.bad === 'mix' ? '接錯相' : '短路'}）` : i.src === 'manual' ? '示波器的手動測試正在控制這顆馬達' : !i.en ? `${moduleLabel(cm.drv)} 沒有送電給線圈` : i.pps ? `STEP ${Math.round(i.pps)} pps，${i.dir * cm.sigma > 0 ? '順時針' : '逆時針'}` : '已送電，停住不動（保持轉矩）';
    t += `\n轉速約 ${Math.abs(i.rpm).toFixed(1)} RPM，位置 ${i.revs.toFixed(2)} 圈${i.lost ? `\n失步：少走了 ${Math.abs(i.lost)} 個全步` : ''}`;
  }
  if (m.type === 'stepper'){
    const i = motorInfo(m);
    t = !i.ok ? '驅動模組沒有供電（VCC 接 3V3、GND 接地）' : i.src === 'manual' ? '示波器的手動測試正在控制這顆馬達' : !i.en ? 'ENABLE 是低電位：馬達沒有送電' : i.k < 0 ? 'CLK 沒有接到計時器的 PWM（STEP）腳' : i.pps ? `STEP ${Math.round(i.pps)} pps，${i.dir > 0 ? '順時針' : '逆時針'}` : '已送電，停住不動（保持轉矩）';
    t += `\n轉速約 ${Math.abs(i.rpm).toFixed(1)} RPM，位置 ${i.revs.toFixed(2)} 圈\n${ustepName(i.div)}：每個脈波 ${i.stepDeg.toFixed(4)}°，一圈 ${i.perRev} 個脈波${i.lost ? `\n失步：少走了 ${Math.abs(i.lost)} 個全步` : ''}`;
  }
  if (m.type === 'can'){
    const L = canLink(), n = nodeOfCan(m), last = n.rx[n.rx.length - 1];
    t = !L.powered ? '收發器沒有供電（檢查 VCC 電壓與 GND）' : !L.ok ? `${!bench.board.can ? '這顆晶片沒有 CAN 控制器' : !L.txOk ? 'TXD 沒有接到 MCU 的 CAN_TX' : 'RXD 沒有接到 MCU 的 CAN_RX'}` : `測試節點：${n.on ? '開啟' : '關閉'}，已送出 ${n.cnt} 筆 ID 0x200`;
    t += `\n收到 MCU 的訊框：${n.rx.length} 筆${last ? `，最後一筆 ID 0x${last.id.toString(16).toUpperCase()}：${last.data.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ')}` : ''}${CAN.txErr ? `\nMCU 有 ${CAN.txErr} 筆訊框沒有收到 ACK` : ''}`;
  }
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
      case 'vendor': insp.vendor = id; renderInspector(); break;
      case 'pick': act.changeBoard(id); break;
      case 'variant': act.setVariant(insp.id, id); break;
      case 'remove': act.removeModule(insp.id); break;
      case 'add': act.addModule(b.dataset.type); break;
      case 'warm': act.warm(insp.id); break;
      case 'analyzer': act.openAnalyzer(insp.id); break;
      case 'stepper': { const m = moduleById(insp.id), tgt = m?.type === 'tb67' ? motorOfDriver(m) : m; if (tgt) act.openStepper(tgt.id); break; }
      case 'psu': { const m = moduleById(insp.id); if (m){ act.setStep(insp.id, 'psu', m.st.on === false); renderInspector(); } break; }
      case 'pinmark': act.markPin?.(b.dataset.id); break;
      case 'erase': act.eraseFlash(insp.id); break;
      case 'node': act.setNode(insp.id, !nodeOfCan(moduleById(insp.id)).on); break;
      case 'motion': act.motion(insp.id); break;
    }
  });
  el.addEventListener('input', e => {
    if (e.target.id === 'boardQuery'){ insp.q = e.target.value; const pos = e.target.selectionStart; renderInspector(); const q = $('#boardQuery'); q.focus(); q.setSelectionRange(pos, pos); }
    if (e.target.id === 'potRange'){ const v = +e.target.value / 100; $('#potOut').textContent = e.target.value + '%'; act.setPot(insp.id, v); }
    if (e.target.id === 'ambT'){ SIM.ambient.T = +e.target.value; $('#ambTOut').textContent = SIM.ambient.T.toFixed(1) + ' °C'; act.changed(); }
    if (e.target.id === 'ambRH'){ SIM.ambient.RH = +e.target.value; $('#ambRHOut').textContent = SIM.ambient.RH + ' %'; act.changed(); }
    if (e.target.id === 'tcT'){ $('#tcTOut').textContent = e.target.value + ' °C'; act.setTc(insp.id, 'tcT', +e.target.value); }
    if (e.target.id === 'tcOpen') act.setTc(insp.id, 'open', e.target.checked);
    if (e.target.id === 'stVref'){ const v = +e.target.value, a = v * VREF_GAIN; $('#stVrefOut').textContent = v.toFixed(2) + ' V'; act.setStep(insp.id, 'vref', v); const n = $('#stVrefNote b'); if (n) n.textContent = a.toFixed(2) + ' A'; }
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'stDiv') act.setStep(insp.id, 'div', +e.target.value);
    if (e.target.id === 'stLoad') act.setStep(insp.id, 'load', +e.target.value);
    if (e.target.id === 'stJdiv') act.setStep(insp.id, 'div', +e.target.value);
  });
  const hold = (down, e) => { if (e.target.id !== 'holdBtn') return; e.preventDefault(); if (down) try { e.target.setPointerCapture(e.pointerId); } catch (_){} act.press(insp.id, down); };
  el.addEventListener('pointerdown', e => hold(true, e));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, e => hold(false, e), true);
}
