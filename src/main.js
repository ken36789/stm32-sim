// 進入點：把模擬核心、3D 場景與介面接在一起
import './styles.css';
import * as THREE from 'three';
import { BOARD_BY_ID, DEFAULT_BOARD, boardParts } from './core/boards.js';
import { MODULE_TYPES, variantOf, DEFAULT_MODULES } from './core/parts.js';
import { hooks } from './core/hooks.js';
import { SIM, bench, PINS, PIN_ORDER, wires, addWire, removeWire, clearWires, wireOf, refreshNet, powered, readPin, moduleState, boardLedOn, i2cDevices, sensorTemp,
  checkDamage, tickSim, setBoard, addModule, removeModule, setVariant, moduleById, moduleLabel, resetBench } from './core/sim.js';
import { runChecks } from './core/checks.js';
import { startProgram, stopProgram, isRunning } from './core/runtime.js';
import { suggestWiring, exampleCode } from './core/codegen.js';
import { R, G, initScene, buildBench, fitView, setLed, pressCap, buildWireMesh, disposeWireMesh, sceneBg, setUsbVisible } from './scene/scene.js';
import { updateModule } from './scene/modules3d.js';
import { WIRE_COLORS, COLOR_NAMES, hex6 } from './scene/util.js';
import { $, esc, toast } from './ui/dom.js';
import { UI, flashState } from './ui/state.js';
import { ta, syncEditor, codeValue, log, editorEvents } from './ui/editor.js';
import { serialOut, serialSys, pushLine } from './ui/serial.js';
import { setRun, updatePills, updateButtons } from './ui/status.js';
import { build, flash } from './ui/build.js';
import { initInspector, renderInspector, showInspector, updateLive } from './ui/inspector.js';

function wireHooks(){
  Object.assign(hooks, {
    toast, afterWiring,
    wireAdded: w => buildWireMesh(w),
    wireRemoved: w => { disposeWireMesh(w); if (UI.selWire === w) selectWire(null); },
    outputs: () => outputsChanged(), serial: serialOut, sys: serialSys, run: setRun,
    sensorDamaged: () => outputsChanged(), recheck: () => doCheck(), benchChanged: onBenchChanged,
  });
  editorEvents.change = () => { codeChanged(); store(); };
  editorEvents.save = tryFlash;
}

/* ---- 主題（系統／淺色／深色） ---- */
const THEMES = ['system', 'light', 'dark'], THEME_LABEL = { system:'主題：跟隨系統', light:'主題：淺色', dark:'主題：深色' };
function applyTheme(t){
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const b = $('#btnTheme'); if (b){ b.textContent = THEME_LABEL[t]; b.dataset.theme = t; }
  try { localStorage.setItem('stm32h7-theme', t); } catch (_){}
}
function initTheme(){
  let t = 'system'; try { t = localStorage.getItem('stm32h7-theme') || 'system'; } catch (_){}
  applyTheme(THEMES.includes(t) ? t : 'system');
  $('#btnTheme').addEventListener('click', e => applyTheme(THEMES[(THEMES.indexOf(e.currentTarget.dataset.theme) + 1) % 3]));
}

/* ---- 分頁 ---- */
const TABS = ['wire', 'parts', 'check', 'code', 'serial'];
function showTab(name){
  UI.tab = name;
  TABS.forEach(t => { const b = $('#t-' + t), p = $('#tab-' + t), on = t === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; p.hidden = !on; });
  if (name === 'serial'){ UI.serialUnread = 0; $('#bSerial').hidden = true; const s = $('#serial'); s.scrollTop = s.scrollHeight; }
  if (name === 'code') syncEditor();
  store();
}
TABS.forEach((t, i) => {
  const b = $('#t-' + t);
  b.addEventListener('click', () => showTab(t));
  b.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]; showTab(n); $('#t-' + n).focus(); } });
});

/* ---- 範例程式 ---- */
UI.lastExample = null;
const isExampleCode = () => UI.lastExample !== null && ta.value === UI.lastExample;
function setCode(src, asExample){ ta.value = src; UI.lastExample = asExample ? src : null; syncEditor(); codeChanged(); store(); }

/* ---- 實驗流程：任何硬體或程式變更後，都要重新檢測（無錯誤）並重新編譯，才能燒錄 ---- */
UI.rev = { hw:0, code:0 }; UI.checkOk = null; UI.checkBad = null; UI.built = null;
const sameRev = r => r && r.hw === UI.rev.hw && r.code === UI.rev.code;
const checkDone = () => sameRev(UI.checkOk), buildDone = () => sameRev(UI.built);
const flashDone = () => SIM.flashed && !SIM.flashed.stale && sameRev(SIM.flashed.rev);
const canRun = () => SIM.flashed && !SIM.flashed.stale;
function hwChanged(){
  UI.rev.hw++;
  if (SIM.flashed && !SIM.flashed.stale){
    SIM.flashed.stale = true;
    if (isRunning()){ stopProgram(true); outputsReset(); serialSys('硬體已變更，MCU 已停止。請重新檢測、編譯並燒錄。', 'er'); }
    setRun('stale'); updatePills(); updateButtons();
  }
  renderFlow();
}
function codeChanged(){ UI.rev.code++; renderFlow(); }
function renderFlow(){
  const st = { check: checkDone() ? 'done' : sameRev(UI.checkBad) ? 'bad' : 'need', build: buildDone() ? 'done' : 'need', flash: flashDone() ? 'done' : checkDone() && buildDone() ? 'need' : '' };
  const mark = { done:'✓', bad:'✕', need:'', '':'' };
  document.querySelectorAll('#flow .step').forEach(b => { const k = b.dataset.step; b.className = 'step ' + st[k]; b.querySelector('i').textContent = mark[st[k]]; });
}
function nudgeFlow(){ const f = $('#flow'); f.classList.remove('pulse'); void f.offsetWidth; f.classList.add('pulse'); }
async function tryFlash(){
  if (!checkDone()){ toast(sameRev(UI.checkBad) ? '接線檢測還有錯誤，修正後再檢測一次。' : '請先完成「接線檢測」。每次更換晶片、模組、接線或修改程式後都要重新檢測。', 'err'); nudgeFlow(); showTab('check'); return; }
  if (!buildDone()){ toast('請先按「編譯」，確認目前的程式沒有錯誤。', 'err'); nudgeFlow(); showTab('code'); return; }
  await flash();
  if (SIM.flashed && !SIM.flashed.rev) SIM.flashed.rev = { ...UI.rev };
  renderFlow();
}
function doBuild(){ const r = build(); UI.built = r.ok ? { ...UI.rev } : null; renderFlow(); toast(r.ok ? '編譯成功。' : '編譯失敗，請看建置輸出。', r.ok ? '' : 'err'); return r; }
document.querySelectorAll('#flow .step').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.step;
  if (k === 'check'){ showTab('check'); doCheck(false); }
  else if (k === 'build'){ showTab('code'); doBuild(); }
  else { showTab('code'); tryFlash(); }
}));
function refreshExample(){ if (isExampleCode()){ const c = exampleCode(); if (c !== ta.value) setCode(c, true); } }
$('#btnExample').addEventListener('click', () => { setCode(exampleCode(), true); log(`已載入 ${bench.board.name} 的範例程式，腳位依目前接線產生。`, 'lo'); toast('已載入範例程式。'); });

/* ---- 開發板與模組 ---- */
function renderBoardInfo(){
  const b = bench.board;
  $('#boardSub').textContent = `${b.name} · ${b.mcu} · ${b.core} ${b.mhz} MHz`;
  $('#serialInfo').textContent = `${b.vcp.periph} · ${b.form === 'pill' ? 'USB 轉 TTL（PA9／PA10）' : `${b.prog} 虛擬序列埠`} · 115200 8N1`;
  $('#pinmapNote').textContent = `${b.name} 的 ${b.header.length} 腳排針。左右兩欄對應實際排列，1 號腳在左上。I2C：${b.i2c.scl}（SCL）、${b.i2c.sda}（SDA）。`;
}
function onBenchChanged(){
  if (G.ready){ buildBench(); setUsbVisible(SIM.usb); }
  fillSelects(); renderPinMap(); renderBoardInfo(); renderInspector();
  afterWiring();
}
function changeBoard(id){
  if (id === bench.board.id){ showInspector('overview'); return; }
  stopProgram(true); SIM.flashed = null;
  const removed = setBoard(id);
  outputsReset(); setRun(powered() ? 'idle' : 'off'); updatePills(); updateButtons();
  showInspector('overview');
  if (G.ready) fitView();
  toast(`已切換到 ${bench.board.name}${removed ? `，拔除了 ${removed} 條接到不存在腳位的線` : ''}。Flash 是空白的，請重新燒錄。`);
}
const ACTIONS = {
  changeBoard,
  setVariant:(id, vid) => { const m = moduleById(id); if (!m || m.variant === vid) return; setVariant(id, vid); showInspector('module', id); toast(`${moduleLabel(m)} 已換成 ${variantOf(m.type, vid).name}。`); },
  removeModule:id => { const m = moduleById(id); if (!m) return; const name = moduleLabel(m); removeModule(id); showInspector('overview'); toast(`已移除 ${name}。`); },
  addModule:type => { const m = addModule(type); if (!m){ toast('工作台最多放 8 個模組。'); return; } showInspector('module', m.id); markModule(m.id); toast(`已新增 ${moduleLabel(m)}。到「接線」分頁按「建議接線」可以自動接好。`); },
  press:(id, down) => pressButton(id, down),
  motion:id => triggerMotion(id), warm:id => warmSensor(id),
  setPot:(id, v) => { const m = moduleById(id); if (m){ m.st.pot = v; outputsChanged(); } },
  changed:() => outputsChanged(),
  focusModule:id => markModule(id),
  focusPart:() => {},
};
function markModule(id){ const m = moduleById(id); if (m) markPins(MODULE_TYPES[m.type].pins.map(p => `${m.id}.${p[0]}`), 0xe7894b, 2500); }
function triggerMotion(id){ const m = moduleById(id); if (!m) return; m.st.motionUntil = performance.now() + variantOf(m.type, m.variant).hold * 1000; outputsChanged(); toast(`${moduleLabel(m)}：模擬有人經過。`); }
function warmSensor(id){ const m = moduleById(id); if (!m) return; m.st.boost = Math.min(m.st.boost + 2.5, 12); outputsChanged(); toast(`手指按住 ${moduleLabel(m)}：約 ${sensorTemp(m).toFixed(1)} °C`); }

/* ---- 接線分頁 ---- */
function fillSelects(){
  const b = bench.board;
  const opt = id => { const p = PINS[id]; return `<option value="${id}">${esc(p.label)}${p.group === 'board' && p.kind === 'gpio' ? ' · ' + esc(p.func.split(' · ')[0]) : ''}</option>`; };
  const groups = [[`${b.name} 排針`, PIN_ORDER.filter(id => PINS[id].group === 'board')], ['電源軌', PIN_ORDER.filter(id => PINS[id].group === 'rail')],
    ...bench.modules.map(m => [`${moduleLabel(m)}（${variantOf(m.type, m.variant).name}）`, PIN_ORDER.filter(id => PINS[id].group === m.id)])];
  const html = groups.filter(g => g[1].length).map(([g, ids]) => `<optgroup label="${esc(g)}">${ids.map(opt).join('')}</optgroup>`).join('');
  const a = $('#selA').value, c = $('#selB').value;
  $('#selA').innerHTML = html; $('#selB').innerHTML = html;
  if (PINS[a]) $('#selA').value = a; if (PINS[c]) $('#selB').value = c;
  if (!$('#selColor').options.length) $('#selColor').innerHTML = `<option value="auto">自動（依用途）</option>` + Object.keys(WIRE_COLORS).map(k => `<option value="${k}">${COLOR_NAMES[k]}色</option>`).join('');
}
function renderPinMap(){
  $('#pinmap').innerHTML = bench.board.header.map((h, i) => `<div class="${h.kind === 'gnd' ? 'gd' : h.kind === 'pwr' ? 'pw' : ''}"><span class="n">${i + 1}</span><span class="p">${esc(h.label)}</span><span class="f" title="${esc(PINS[h.id]?.func || '')}">${h.mcu && h.mcu !== h.label ? esc(h.mcu) + ' · ' : ''}${esc(PINS[h.id]?.func || '')}</span></div>`).join('');
}
$('#btnAdd').addEventListener('click', () => { const c = $('#selColor').value, a = $('#selA').value, b = $('#selB').value; if (addWire(a, b, c === 'auto' ? null : c)) toast(`已接上：${PINS[a].label} → ${PINS[b].label}`); });
$('#btnSuggest').addEventListener('click', () => {
  clearWires(true); const pairs = suggestWiring(); pairs.forEach(([a, b]) => addWire(a, b, null, true)); afterWiring();
  toast(`已依 ${bench.board.name} 與目前的模組接好 ${pairs.length} 條線。`);
});
$('#btnClear').addEventListener('click', () => { if (!wires.length) return; clearWires(); toast('已拔除所有杜邦線。'); });
function renderWireList(){
  $('#wireCount').textContent = wires.length ? `${wires.length} 條` : '';
  const ul = $('#wireList');
  if (!wires.length){ ul.innerHTML = `<li class="empty" style="display:block;cursor:default">還沒有接線。點 3D 畫面上的金色腳位，或按「建議接線」。</li>`; return; }
  ul.innerHTML = wires.map(w => `<li data-id="${w.id}" class="${UI.selWire === w ? 'on' : ''}"><span class="sw" style="background:${hex6(WIRE_COLORS[w.color])}"></span><span class="t">${esc(PINS[w.a].label)} → ${esc(PINS[w.b].label)}<small>${COLOR_NAMES[w.color]}色杜邦線 · ${esc(PINS[w.a].func.split(' · ')[0])}</small></span><button class="btn sm ghost danger" data-del="${w.id}" type="button" aria-label="拔除這條線">拔除</button></li>`).join('');
}
$('#wireList').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), li = e.target.closest('li[data-id]'); if (!li) return;
  const w = wires.find(x => x.id === +li.dataset.id); if (!w) return;
  if (del){ removeWire(w); return; }
  selectWire(UI.selWire === w ? null : w); markPins([w.a, w.b], 0xe7894b);
});

/* ---- 3D 選取 ---- */
function refreshRings(){
  if (!G.ready) return;
  for (const [id, p] of Object.entries(G.pins)){
    let c = null;
    if (UI.sel === id) c = 0xff8a3d; else if (UI.marks[id]) c = UI.marks[id].color; else if (UI.hover === id) c = 0xffffff;
    p.ring.visible = c !== null; if (c !== null) p.ring.material.color.setHex(c);
    p.ring.scale.setScalar(1);
  }
}
function markPins(ids, color, ms = 3500){ const until = performance.now() + ms; ids.forEach(id => { if (PINS[id]) UI.marks[id] = { color, until }; }); refreshRings(); }
function renderHint(){
  const h = $('#hint');
  if (UI.sel && PINS[UI.sel]){ const p = PINS[UI.sel]; h.hidden = false; h.innerHTML = `已選 <span class="sel">${esc(p.label)}</span>（${esc(p.func.split(' · ')[0])}）<br>再點另一個腳位接線；點空白處取消。`; return; }
  let seen = false; try { seen = localStorage.getItem('stm32-sim-hint') === '1'; } catch (_){}
  h.hidden = seen;
  h.innerHTML = `<ol><li><b>1</b>點兩個金色腳位接線，或按「建議接線」</li><li><b>2</b>點晶片或模組可以查看資料、更換型號</li><li><b>3</b>依序完成上方的檢測、編譯、燒錄</li></ol>`;
}
function hintSeen(){ try { localStorage.setItem('stm32-sim-hint', '1'); } catch (_){} }
function selectWire(w){
  UI.selWire = w;
  wires.forEach(x => { if (x.mesh) x.mesh.mat.emissive.setHex(x === w ? 0x553311 : 0); });
  $('#wirepop').hidden = !w;
  if (w){ $('#wpText').textContent = `${PINS[w.a].label} → ${PINS[w.b].label}`; $('#wpSw').style.background = hex6(WIRE_COLORS[w.color]); }
  renderWireList();
}
$('#wpDel').addEventListener('click', () => { if (UI.selWire){ removeWire(UI.selWire); toast('已拔除這條線。'); } });
function openInspector(view, id){ showTab('parts'); showInspector(view, id); }
function onPick(h){
  hintSeen();
  if (!h){ if (UI.sel || UI.selWire){ UI.sel = null; selectWire(null); refreshRings(); renderHint(); } return; }
  if (h.type === 'usb'){ setUsb(!SIM.usb); return; }
  if (h.type === 'part'){ openInspector('part', h.key); return; }
  if (h.type === 'module'){ openInspector('module', h.id); markModule(h.id); return; }
  if (h.type === 'touch'){ const m = moduleById(h.id); if (m?.type === 'pir') triggerMotion(h.id); else if (m) warmSensor(h.id); return; }
  if (h.type === 'wire'){ UI.sel = null; refreshRings(); renderHint(); selectWire(h.w); return; }
  if (h.type !== 'pin') return;
  const id = h.id;
  if (!UI.sel){
    const w = wireOf(id);
    if (w && PINS[id].kind !== 'mod'){ selectWire(w); markPins([w.a, w.b], 0xe7894b, 1500); return; }
    selectWire(null); UI.sel = id;
  } else if (UI.sel === id) UI.sel = null;
  else { const a = UI.sel; UI.sel = null; if (addWire(a, id)) toast(`已接上：${PINS[a].label} → ${PINS[id].label}`); }
  refreshRings(); renderHint();
}
function tipFor(h){
  const b = bench.board;
  if (h.type === 'pin'){ const p = PINS[h.id], ws = wires.filter(w => w.a === h.id || w.b === h.id); return `<b>${esc(p.label)}</b>\n${esc(p.func)}${ws.map(w => '\n已接到 ' + esc(PINS[w.a === h.id ? w.b : w.a].label)).join('')}`; }
  if (h.type === 'wire') return `<b>${esc(PINS[h.w.a].label)} → ${esc(PINS[h.w.b].label)}</b>\n點一下可拔除`;
  if (h.type === 'usb') return `<b>USB（${esc(b.prog)}）</b>\n點一下${SIM.usb ? '拔除' : '接上'}`;
  if (h.type === 'part'){ const p = boardParts(b).find(x => x.key === h.key); return `<b>${esc(p?.part || '')}</b>\n${esc(p?.name || '')}\n點一下查看資料與 datasheet`; }
  if (h.type === 'module'){ const m = moduleById(h.id); return m ? `<b>${esc(moduleLabel(m))}</b>\n${esc(variantOf(m.type, m.variant).part)}\n點一下查看資料、更換型號` : ''; }
  if (h.type === 'press'){ if (h.which === 'B1') return `<b>${esc(b.btn.name)}</b>（${esc(b.btn.pin)}）\n按住＝按下`; if (h.which === 'RESET') return '<b>RESET</b>\n按下後放開會重新執行程式'; const m = moduleById(h.which); return m ? `<b>${esc(moduleLabel(m))}</b>\n按住＝OUT 高電位` : ''; }
  if (h.type === 'touch'){ const m = moduleById(h.id); return !m ? '' : m.type === 'pir' ? `<b>${esc(moduleLabel(m))}</b>\n點一下模擬有人經過` : `<b>${esc(moduleLabel(m))}</b>\n約 ${sensorTemp(m).toFixed(2)} °C\n點一下模擬手指加溫`; }
  return '';
}
function setHover(h, e){
  const tip = $('#tip'), id = h && h.type === 'pin' ? h.id : null;
  if (UI.hover !== id){ UI.hover = id; refreshRings(); }
  if (!h || !e){ tip.hidden = true; if (R.renderer) R.renderer.domElement.style.cursor = ''; return; }
  R.renderer.domElement.style.cursor = 'pointer';
  tip.innerHTML = tipFor(h); tip.hidden = !tip.innerHTML;
  const r = $('#stage').getBoundingClientRect(); let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  x = Math.min(x, r.width - tip.offsetWidth - 8); y = Math.min(y, r.height - tip.offsetHeight - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function pressButton(which, down){
  pressCap(which, down);
  if (which === 'B1') SIM.b1 = down;
  else if (which === 'RESET'){ if (!canRun()){ if (down && SIM.flashed) toast('硬體已變更，請重新檢測、編譯並燒錄後再重設。', 'err'); } else if (down){ stopProgram(true); outputsReset(); if (powered()) setRun('reset'); } else if (powered()) startProgram(); }
  else { const m = moduleById(which); if (m) m.st.pressed = down; }
  outputsChanged();
}
function setupPointer(){
  const el = R.renderer.domElement, stage = $('#stage'), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, pressing = null;
  const pick = e => { const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, R.camera); const hs = ray.intersectObjects([...G.hit, ...G.wireHit], false); return hs.length ? hs[0].object.userData : null; };
  stage.addEventListener('pointerdown', e => {
    if (e.target !== el) return;
    const h = pick(e); down = { x:e.clientX, y:e.clientY };
    if (h && h.type === 'press'){ pressing = h; R.controls.enabled = false; pressButton(h.which, true); try { el.setPointerCapture(e.pointerId); } catch (_){} }
  }, true);
  const release = () => { if (pressing){ pressButton(pressing.which, false); pressing = null; R.controls.enabled = true; } };
  el.addEventListener('pointerup', e => {
    if (pressing){ release(); down = null; return; }
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved < 8) onPick(pick(e));
  });
  el.addEventListener('pointercancel', () => { release(); down = null; });
  el.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || e.buttons){ if (UI.hover) setHover(null); else $('#tip').hidden = true; return; } setHover(pick(e), e); });
  el.addEventListener('pointerleave', () => setHover(null));
}

/* ---- 電源、輸出與聲音 ---- */
let wasPowered = null;
function afterWiring(){ refreshNet(); hwChanged(); electricalUpdate(); renderWireList(); refreshRings(); renderHint(); if (UI.checked) doCheck(true); refreshExample(); store(); }
function electricalUpdate(){
  const p = powered();
  for (const m of checkDamage()) toast(`${moduleLabel(m)}（${variantOf(m.type, m.variant).part}）的電壓過高，已損壞（模擬）。改好接線後到「檢測」更換。`, 'err');
  if (wasPowered !== null && p !== wasPowered){
    if (!p){ stopProgram(true); outputsReset(); setRun(SIM.flashed ? 'off' : 'idle'); toast(SIM.usb ? '短路！USB 過電流保護啟動，開發板斷電。' : 'USB 已拔除，開發板斷電。', SIM.usb ? 'err' : ''); }
    else { toast('開發板通電。'); if (canRun()) startProgram(); else setRun(SIM.flashed ? 'stale' : 'idle'); }
  }
  wasPowered = p; outputsChanged(); updatePills();
}
function setUsb(on){ SIM.usb = on; setUsbVisible(on); $('#btnUsb').textContent = on ? '拔除 USB' : '接上 USB'; electricalUpdate(); updateButtons(); }
$('#btnUsb').addEventListener('click', () => setUsb(!SIM.usb));
$('#btnView').addEventListener('click', () => G.ready && fitView());
function outputsReset(){ SIM.out = {}; SIM.mode = {}; outputsChanged(); }
let outPending = false;
function outputsChanged(){ if (outPending) return; outPending = true; requestAnimationFrame(applyOutputs); }
const audio = { ctx:null, gain:null, enabled:false, buzz:false, relays:{} };
function ensureAudio(){
  if (audio.ctx) return audio.ctx.state === 'suspended' ? audio.ctx.resume() : null;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  audio.ctx = new AC(); audio.gain = audio.ctx.createGain(); audio.gain.gain.value = 0;
  const osc = audio.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 2300; osc.connect(audio.gain); audio.gain.connect(audio.ctx.destination); osc.start();
}
function setBuzz(on){ on = on && audio.enabled; if (on === audio.buzz || !audio.ctx) return; audio.buzz = on; audio.gain.gain.setTargetAtTime(on ? .035 : 0, audio.ctx.currentTime, .008); }
function relayClick(){
  if (!audio.enabled || !audio.ctx) return;
  const c = audio.ctx, buf = c.createBuffer(1, 600, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 70);
  const s = c.createBufferSource(), g = c.createGain(); g.gain.value = .25; s.buffer = buf; s.connect(g); g.connect(c.destination); s.start();
}
function testBeep(){
  if (!audio.ctx) return;
  const c = audio.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 2300; g.gain.value = .035;
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .12);
}
$('#btnSound').addEventListener('click', e => {
  audio.enabled = !audio.enabled;
  if (audio.enabled){
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_){}   // iOS：靜音開關打開時也能發聲
    ensureAudio(); testBeep();
    toast(bench.modules.some(m => m.type === 'buzzer') ? '聲音已開啟。程式執行時，按住按鈕模組，蜂鳴器就會響。' : '聲音已開啟。到「元件」分頁新增蜂鳴器模組，就能聽到程式控制的聲音。');
  } else setBuzz(false);
  e.currentTarget.textContent = audio.enabled ? '聲音：開' : '聲音：關'; e.currentTarget.setAttribute('aria-pressed', audio.enabled); outputsChanged(); store();
});
function applyOutputs(){
  outPending = false; const p = powered(), t = performance.now(); let buzz = false;
  if (G.ready){
    setLed('PWR', p); bench.board.leds.forEach(l => setLed(l.name, boardLedOn(l)));
    for (const m of bench.modules){
      const s = moduleState(m); updateModule(m, s, t);
      if (m.type === 'buzzer' && s.on) buzz = true;
      if (m.type === 'relay'){ if (audio.relays[m.id] !== undefined && audio.relays[m.id] !== s.on) relayClick(); audio.relays[m.id] = s.on; }
    }
  }
  setBuzz(buzz); updateLive();
  const pins = Object.keys(SIM.mode).sort();
  $('#gpioChips').innerHTML = pins.length ? pins.map(k => { const v = SIM.mode[k] === 'out' ? SIM.out[k] : readPin(k); return `<span class="chip ${v ? 'hi' : ''}">${k}<i>${SIM.mode[k] === 'out' ? '輸出' : '輸入'}</i>${v ? 'H' : 'L'}</span>`; }).join('') : '<span class="note" style="margin:0">程式執行後，這裡會顯示用到的 GPIO 與電位。</span>';
}
$('#btnBuild').addEventListener('click', doBuild);
$('#btnFlash').addEventListener('click', tryFlash);
$('#btnReset').addEventListener('click', () => { if (canRun() && powered()) startProgram(); });
$('#btnStop').addEventListener('click', () => { stopProgram(); outputsChanged(); serialSys('除錯器已暫停 MCU'); });

/* ---- 檢測 ---- */
function doCheck(quiet){
  UI.checked = true;
  const res = runChecks(codeValue()), cnt = { err:0, warn:0, ok:0, info:0 }; res.forEach(r => cnt[r.sev]++);
  if (!quiet){ UI.checkOk = cnt.err ? null : { ...UI.rev }; UI.checkBad = cnt.err ? { ...UI.rev } : null; renderFlow(); }
  $('#bCheck').hidden = !cnt.err; $('#bCheck').textContent = cnt.err;
  const lab = { err:'錯誤', warn:'警告', ok:'通過', info:'提示' };
  $('#sum').innerHTML = ['err', 'warn', 'ok'].map(k => `<span class="tag ${k}">${lab[k]} ${cnt[k]}</span>`).join('');
  UI.checkRes = res;
  $('#results').innerHTML = res.map((r, i) => `<li tabindex="0" data-i="${i}"><span class="tag ${r.sev}">${lab[r.sev]}</span><div><strong>${esc(r.title)}</strong><p>${esc(r.detail)}</p>${r.action ? `<button class="btn sm" data-act="${i}" type="button">${esc(r.action.label)}</button>` : ''}</div></li>`).join('');
  if (!quiet){
    markPins(res.filter(r => r.sev === 'warn').flatMap(r => r.pins), 0xffc21a, 4000); markPins(res.filter(r => r.sev === 'err').flatMap(r => r.pins), 0xff3b3b, 4000);
    toast(cnt.err ? `發現 ${cnt.err} 個錯誤、${cnt.warn} 個警告。` : cnt.warn ? `沒有錯誤，有 ${cnt.warn} 個警告。` : '接線全部正確。', cnt.err ? 'err' : '');
  }
}
$('#btnCheck').addEventListener('click', () => doCheck(false));
$('#results').addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (a){ UI.checkRes[+a.dataset.act].action.fn(); return; }
  const li = e.target.closest('li[data-i]'); if (!li) return; const r = UI.checkRes[+li.dataset.i];
  markPins(r.pins, { err:0xff3b3b, warn:0xffc21a, ok:0x3ddc84, info:0x7db6d6 }[r.sev], 4000);
});
$('#results').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('li')) e.target.click(); });

/* ---- 儲存（僅本機瀏覽器） ---- */
const KEY = 'stm32-sim-v2';
let storeTimer;
function store(){
  clearTimeout(storeTimer);
  storeTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ board:bench.board.id, modules:bench.modules.map(m => ({ id:m.id, type:m.type, variant:m.variant, slot:m.slot })), wires:wires.map(w => [w.a, w.b, w.color]), code:ta.value, example:isExampleCode(), tab:UI.tab, sound:audio.enabled })); } catch (_){} }, 300);
}
function restore(){ try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_){ return null; } }

/* ---- 動畫迴圈 ---- */
let lastT = performance.now(), frame = 0;
function loop(t){
  requestAnimationFrame(loop);
  const dt = Math.min(.1, (t - lastT) / 1000); lastT = t; frame++;
  tickSim(dt); R.controls.update();
  const now = performance.now(); let changed = false;
  for (const [id, mk] of Object.entries(UI.marks)) if (mk.until < now){ delete UI.marks[id]; changed = true; }
  if (changed) refreshRings();
  if (UI.sel && G.pins[UI.sel]) G.pins[UI.sel].ring.scale.setScalar(1 + .18 * Math.sin(t / 160));
  setLed('COM', flashState.busy ? Math.floor(t / 110) % 2 === 0 : false);
  if (frame % 6 === 0) applyOutputs();
  if (UI.selWire && UI.selWire.mesh){
    const v = UI.selWire.mesh.mid.clone().project(R.camera), el = $('#stage'), pop = $('#wirepop');
    pop.style.left = ((v.x + 1) / 2 * el.clientWidth) + 'px'; pop.style.top = ((1 - v.y) / 2 * el.clientHeight) + 'px';
  }
  if (frame % 30 === 0){ const d = i2cDevices()[0], tr = $('#tempRead'); tr.hidden = !d; if (d) tr.textContent = `${moduleLabel(d.m)} ${sensorTemp(d.m).toFixed(2)} °C`; }
  R.renderer.render(R.scene, R.camera);
}

/* ---- iPhone／iPad：長按按鈕、清單或 3D 畫面時不要跳出選單 ---- */
document.addEventListener('contextmenu', e => { if (e.target.closest('button, .tabs, .flow, .plist, .wires li, .results li, .chips, .stage, .pill')) e.preventDefault(); });

/* ---- 主題變更時更新 3D 背景 ---- */
function themeChanged(){ if (R.scene) R.scene.background = new THREE.Color(sceneBg()); }
const darkMq = matchMedia('(prefers-color-scheme: dark)');
if (darkMq.addEventListener) darkMq.addEventListener('change', themeChanged); else darkMq.addListener(themeChanged);
new MutationObserver(themeChanged).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });

/* ---- 啟動 ---- */
(async function boot(){
  initTheme(); wireHooks(); initInspector(ACTIONS);
  const saved = restore();
  resetBench();
  setBoard(saved && BOARD_BY_ID[saved.board] ? saved.board : DEFAULT_BOARD, true);
  if (saved && Array.isArray(saved.modules)) saved.modules.forEach(m => MODULE_TYPES[m.type] && addModule(m.type, m.variant, true, m));
  else DEFAULT_MODULES.forEach(m => addModule(m.type, m.variant, true));
  renderHint(); renderBoardInfo();
  log('按「編譯並燒錄」把 main.c 寫進開發板的 Flash。快捷鍵 Ctrl/⌘ + S。', 'ld');
  pushLine('— 序列埠已開啟，等待開發板輸出 —', 'sys'); UI.serialUnread = 0; $('#bSerial').hidden = true;
  let ok3d = false;
  try { await Promise.race([Promise.all([document.fonts.load('600 24px "JetBrains Mono"'), document.fonts.load('600 24px "Chakra Petch"')]), new Promise(r => setTimeout(r, 1500))]); } catch (_){}
  try { initScene($('#stage')); setupPointer(); ok3d = true; } catch (e){ console.error(e); }
  $('#loading').hidden = ok3d;
  if (!ok3d) $('#loading').textContent = '這個裝置無法啟用 3D 畫面（WebGL）。仍可在右側面板接線、檢測、編譯與燒錄。';
  if (saved && Array.isArray(saved.wires)) saved.wires.forEach(([a, b, c]) => PINS[a] && PINS[b] && addWire(a, b, WIRE_COLORS[c] ? c : null, true));
  else suggestWiring().forEach(([a, b]) => addWire(a, b, null, true));
  refreshNet();
  if (saved && typeof saved.code === 'string'){ ta.value = saved.code; UI.lastExample = saved.example ? saved.code : null; syncEditor(); }
  else setCode(exampleCode(), true);
  fillSelects(); renderPinMap(); renderInspector();
  afterWiring(); setUsb(true); updateButtons(); renderFlow();
  if (saved?.sound){ audio.enabled = true; $('#btnSound').textContent = '聲音：開'; $('#btnSound').setAttribute('aria-pressed', 'true'); document.addEventListener('pointerdown', ensureAudio, { once:true }); }
  if (saved && TABS.includes(saved.tab)) showTab(saved.tab);
  if (ok3d) requestAnimationFrame(loop);
})();
