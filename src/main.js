// 進入點：把模擬核心、3D 場景與介面接在一起
import './styles.css';
import * as THREE from 'three';
import { J1, MODS, PINS, PIN_ORDER, WIRE_COLORS, COLOR_NAMES, hex6, SAMPLE, FULL } from './core/board.js';
import { hooks } from './core/hooks.js';
import { wires, SIM, addWire, removeWire, clearWires, wireOf, refreshNet, powered, netInfo, readPin, ledOn, i2cState, tempC } from './core/sim.js';
import { runChecks } from './core/checks.js';
import { startProgram, stopProgram } from './core/runtime.js';
import { DEFAULT_CODE } from './core/default-code.js';
import { R, G, buildScene, fitView, setLed, pressCap, setSensorDamaged, buildWireMesh, disposeWireMesh, sceneBg } from './scene/scene.js';
import { $, esc, toast } from './ui/dom.js';
import { UI, flashState } from './ui/state.js';
import { ta, syncEditor, codeValue, log, editorEvents } from './ui/editor.js';
import { serialOut, serialSys, pushLine } from './ui/serial.js';
import { setRun, updatePills, updateButtons } from './ui/status.js';
import { build, flash } from './ui/build.js';

function wireHooks(){
  Object.assign(hooks, {
    toast, afterWiring,
    wireAdded: w => buildWireMesh(w),
    wireRemoved: w => { disposeWireMesh(w); if (UI.selWire === w) selectWire(null); },
    outputs: () => outputsChanged(),
    serial: serialOut, sys: serialSys, run: setRun,
    sensorDamaged: setSensorDamaged, recheck: () => doCheck(),
  });
  editorEvents.change = store;
  editorEvents.save = flash;
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
const TABS = ['wire', 'check', 'code', 'serial'];
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
  b.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : 3)) % 4]; showTab(n); $('#t-' + n).focus(); } });
});

/* ---- 接線分頁 ---- */
function fillSelects(){
  const groups = [['開發板 J1 排針', PIN_ORDER.filter(id => PINS[id].group === 'board')], ...Object.entries(MODS).map(([k, m]) => [m.name, PIN_ORDER.filter(id => PINS[id].group === k)])];
  const html = groups.map(([g, ids]) => `<optgroup label="${g}">${ids.map(id => `<option value="${id}">${esc(PINS[id].label)}${PINS[id].group === 'board' && PINS[id].kind === 'gpio' ? ' · ' + esc(PINS[id].func.split(' · ')[0]) : ''}</option>`).join('')}</optgroup>`).join('');
  $('#selA').innerHTML = html; $('#selB').innerHTML = html;
  $('#selA').value = 'J1-7'; $('#selB').value = 'LED.SIG';
  $('#selColor').innerHTML = `<option value="auto">自動（依用途）</option>` + Object.keys(WIRE_COLORS).map(c => `<option value="${c}">${COLOR_NAMES[c]}色</option>`).join('');
  $('#pinmap').innerHTML = J1.map(([n, f], i) => `<div class="${n === 'GND' ? 'gd' : (n === '3V3' || n === '5V') ? 'pw' : ''}"><span class="n">${i + 1}</span><span class="p">${n}</span><span class="f" title="${esc(f)}">${esc(f)}</span></div>`).join('');
}
$('#btnAdd').addEventListener('click', () => { const c = $('#selColor').value; if (addWire($('#selA').value, $('#selB').value, c === 'auto' ? null : c)) toast('已接上：' + PINS[$('#selA').value].label + ' → ' + PINS[$('#selB').value].label); });
$('#btnSample').addEventListener('click', () => { loadWiring(SAMPLE); toast('已載入範例接線，其中有一處錯誤，到「檢測」找找看。'); });
$('#btnFull').addEventListener('click', () => { loadWiring(FULL); toast('已載入完整且正確的接線。'); });
$('#btnClear').addEventListener('click', () => { if (!wires.length) return; clearWires(); toast('已拔除所有杜邦線。'); });
function loadWiring(list){ clearWires(true); list.forEach(([a, b]) => addWire(a, b, null, true)); afterWiring(); }
function renderWireList(){
  $('#wireCount').textContent = wires.length ? `${wires.length} 條` : '';
  const ul = $('#wireList');
  if (!wires.length){ ul.innerHTML = `<li class="empty" style="display:block;cursor:default">還沒有接線。點 3D 畫面上的金色腳位，或按「範例接線」。</li>`; return; }
  ul.innerHTML = wires.map(w => `<li data-id="${w.id}" class="${UI.selWire === w ? 'on' : ''}"><span class="sw" style="background:${hex6(WIRE_COLORS[w.color])}"></span><span class="t">${esc(PINS[w.a].label)} → ${esc(PINS[w.b].label)}<small>${COLOR_NAMES[w.color]}色杜邦線 · ${esc(PINS[w.a].func.split(' · ')[0])}</small></span><button class="btn sm ghost danger" data-del="${w.id}" type="button" aria-label="拔除這條線">拔除</button></li>`).join('');
}
$('#wireList').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'); const li = e.target.closest('li[data-id]'); if (!li) return;
  const w = wires.find(x => x.id === +li.dataset.id); if (!w) return;
  if (del){ removeWire(w); return; }
  selectWire(UI.selWire === w ? null : w); markPins([w.a, w.b], 0xe7894b);
});

/* ---- 3D 選取與提示 ---- */
function refreshRings(){
  if (!G.ready) return;
  for (const [id, p] of Object.entries(G.pins)){
    let c = null;
    if (UI.sel === id) c = 0xff8a3d; else if (UI.marks[id]) c = UI.marks[id].color; else if (UI.hover === id) c = 0xffffff;
    p.ring.visible = c !== null; if (c !== null) p.ring.material.color.setHex(c);
    p.ring.scale.setScalar(1);
  }
}
function markPins(ids, color, ms = 3500){
  const until = performance.now() + ms; ids.forEach(id => { if (PINS[id]) UI.marks[id] = { color, until }; }); refreshRings();
}
function renderHint(){
  const h = $('#hint');
  if (UI.sel){ const p = PINS[UI.sel]; h.innerHTML = `已選 <span class="sel">${esc(p.label)}</span>（${esc(p.func.split(' · ')[0])}）<br>再點另一個腳位接線；點空白處取消。`; return; }
  h.innerHTML = `<ol><li><b>1</b>依序點兩個金色腳位接上杜邦線</li><li><b>2</b>到「檢測」檢查接線是否正確</li><li><b>3</b>到「程式」編譯並燒錄，看 LED 與序列埠</li></ol>`;
}
function selectWire(w){
  UI.selWire = w;
  wires.forEach(x => { if (x.mesh) x.mesh.mat.emissive.setHex(x === w ? 0x553311 : 0); });
  $('#wirepop').hidden = !w;
  if (w){ $('#wpText').textContent = `${PINS[w.a].label} → ${PINS[w.b].label}`; $('#wpSw').style.background = hex6(WIRE_COLORS[w.color]); }
  renderWireList();
}
$('#wpDel').addEventListener('click', () => { if (UI.selWire){ removeWire(UI.selWire); toast('已拔除這條線。'); } });
function onPick(h){
  if (!h){ if (UI.sel || UI.selWire){ UI.sel = null; selectWire(null); refreshRings(); renderHint(); } return; }
  if (h.type === 'usb'){ setUsb(!SIM.usb); return; }
  if (h.type === 'sensor'){ SIM.tempBoost = Math.min(SIM.tempBoost + 2.5, 12); toast(`手指按住感測器：約 ${tempC().toFixed(1)} °C`); return; }
  if (h.type === 'wire'){ UI.sel = null; refreshRings(); renderHint(); selectWire(h.w); return; }
  if (h.type !== 'pin') return;
  const id = h.id;
  if (!UI.sel){
    const w = wireOf(id);
    if (w){ selectWire(w); markPins([w.a, w.b], 0xe7894b, 1500); return; }
    selectWire(null); UI.sel = id;
  } else if (UI.sel === id){ UI.sel = null; }
  else {
    const a = UI.sel; UI.sel = null;
    const w = addWire(a, id);
    if (w) toast(`已接上：${PINS[a].label} → ${PINS[id].label}`);
  }
  refreshRings(); renderHint();
}
function setHover(h, e){
  const tip = $('#tip'), id = h && h.type === 'pin' ? h.id : null;
  if (UI.hover !== id){ UI.hover = id; refreshRings(); }
  if (!h || !e){ tip.hidden = true; R.renderer && (R.renderer.domElement.style.cursor = ''); return; }
  R.renderer.domElement.style.cursor = 'pointer';
  let html = '';
  if (h.type === 'pin'){ const p = PINS[h.id], w = wireOf(h.id); html = `<b>${esc(p.label)}</b>\n${esc(p.func)}${w ? '\n已接到 ' + esc(PINS[w.a === h.id ? w.b : w.a].label) : ''}`; }
  else if (h.type === 'wire') html = `<b>${esc(PINS[h.w.a].label)} → ${esc(PINS[h.w.b].label)}</b>\n點一下可拔除`;
  else if (h.type === 'usb') html = SIM.usb ? '<b>USB（ST-LINK）</b>\n點一下拔除' : '<b>USB（ST-LINK）</b>\n點一下接上';
  else if (h.type === 'press') html = { B1:'<b>B1 USER</b>（PC13）\n按住＝高電位', B2:'<b>B2 RESET</b>\n按下後放開會重新執行程式', BTN:'<b>按鈕模組</b>\n按住＝OUT 高電位' }[h.which];
  else if (h.type === 'sensor') html = `<b>I2C 溫度感測器</b>\n目前約 ${tempC().toFixed(2)} °C\n點一下模擬手指加溫`;
  tip.innerHTML = html; tip.hidden = false;
  const r = $('#stage').getBoundingClientRect(); let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  x = Math.min(x, r.width - tip.offsetWidth - 8); y = Math.min(y, r.height - tip.offsetHeight - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function pressButton(which, down){
  pressCap(which, down);
  if (which === 'B1') SIM.b1 = down;
  if (which === 'BTN') SIM.btn = down;
  if (which === 'B2'){ if (down){ stopProgram(true); outputsReset(); setRun(SIM.flashed && powered() ? 'reset' : SIM.run); } else if (SIM.flashed && powered()) startProgram(); }
  outputsChanged();
}
function setupPointer(){
  const el = R.renderer.domElement, stage = $('#stage'), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, pressing = null;
  const pick = e => { const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, R.camera); const hs = ray.intersectObjects(G.hit, false); return hs.length ? hs[0].object.userData : null; };
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

/* ---- 電源與輸出 ---- */
let wasPowered = null;
function afterWiring(){ refreshNet(); electricalUpdate(); renderWireList(); refreshRings(); renderHint(); if (UI.checked) doCheck(true); store(); }
function electricalUpdate(){
  const p = powered();
  if (p && netInfo('SEN.VCC').v5 && !SIM.senDamaged){ SIM.senDamaged = true; setSensorDamaged(true); toast('感測器 VCC 接到 5V，晶片已損壞（模擬）。改接 3V3 後到「檢測」更換。', 'err'); }
  if (wasPowered !== null && p !== wasPowered){
    if (!p){ stopProgram(true); outputsReset(); setRun(SIM.flashed ? 'off' : 'idle'); toast(SIM.usb ? '短路！USB 過電流保護啟動，開發板斷電。' : 'USB 已拔除，開發板斷電。', SIM.usb ? 'err' : ''); }
    else { toast('開發板通電。'); if (SIM.flashed) startProgram(); else setRun('idle'); }
  }
  wasPowered = p; outputsChanged(); updatePills();
}
function setUsb(on){ SIM.usb = on; if (G.usb) G.usb.visible = on; $('#btnUsb').textContent = on ? '拔除 USB' : '接上 USB'; electricalUpdate(); updateButtons(); }
$('#btnUsb').addEventListener('click', () => setUsb(!SIM.usb));
$('#btnView').addEventListener('click', () => G.ready && fitView());
function outputsReset(){ SIM.out = {}; SIM.mode = {}; outputsChanged(); }
let outPending = false;
function outputsChanged(){ if (outPending) return; outPending = true; requestAnimationFrame(applyOutputs); }
function applyOutputs(){
  outPending = false; const p = powered();
  if (G.ready){
    setLed('PWR', p);
    setLed('LD1', p && !!SIM.out.PB0); setLed('LD2', p && !!SIM.out.PE1); setLed('LD3', p && !!SIM.out.PB14);
    setLed('EXT', ledOn());
  }
  const pins = Object.keys(SIM.mode).sort();
  $('#gpioChips').innerHTML = pins.length ? pins.map(k => { const v = SIM.mode[k] === 'out' ? SIM.out[k] : readPin(k); return `<span class="chip ${v ? 'hi' : ''}">${k}<i>${SIM.mode[k] === 'out' ? '輸出' : '輸入'}</i>${v ? 'H' : 'L'}</span>`; }).join('') : '<span class="note" style="margin:0">程式執行後，這裡會顯示用到的 GPIO 與電位。</span>';
}
$('#btnBuild').addEventListener('click', () => { const r = build(); toast(r.ok ? '編譯成功。' : '編譯失敗，請看建置輸出。', r.ok ? '' : 'err'); });
$('#btnFlash').addEventListener('click', flash);
$('#btnReset').addEventListener('click', () => { if (SIM.flashed && powered()) startProgram(); });
$('#btnStop').addEventListener('click', () => { stopProgram(); outputsChanged(); serialSys('除錯器已暫停 MCU'); });

/* ---- 檢測 ---- */
function doCheck(quiet){
  UI.checked = true;
  const res = runChecks(codeValue()), cnt = { err:0, warn:0, ok:0, info:0 }; res.forEach(r => cnt[r.sev]++);
  UI.checkErrs = cnt.err; $('#bCheck').hidden = !cnt.err; $('#bCheck').textContent = cnt.err;
  const lab = { err:'錯誤', warn:'警告', ok:'通過', info:'提示' };
  $('#sum').innerHTML = ['err', 'warn', 'ok'].map(k => `<span class="tag ${k}">${lab[k]} ${cnt[k]}</span>`).join('');
  UI.checkRes = res;
  $('#results').innerHTML = res.map((r, i) => `<li tabindex="0" data-i="${i}"><span class="tag ${r.sev}">${lab[r.sev]}</span><div><strong>${esc(r.title)}</strong><p>${esc(r.detail)}</p>${r.action ? `<button class="btn sm" data-act="${i}" type="button">${esc(r.action.label)}</button>` : ''}</div></li>`).join('');
  if (!quiet){
    const bad = res.filter(r => r.sev === 'err').flatMap(r => r.pins), warn = res.filter(r => r.sev === 'warn').flatMap(r => r.pins);
    markPins(warn, 0xffc21a, 4000); markPins(bad, 0xff3b3b, 4000);
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
const KEY = 'stm32h7-bench-v1';
let storeTimer;
function store(){ clearTimeout(storeTimer); storeTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ wires:wires.map(w => [w.a, w.b, w.color]), code:ta.value, tab:UI.tab })); } catch (_){} }, 300); }
function restore(){ try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_){ return null; } }

/* ---- 動畫迴圈 ---- */
let lastT = performance.now();
function loop(t){
  requestAnimationFrame(loop);
  const dt = Math.min(.1, (t - lastT) / 1000); lastT = t;
  SIM.tempBoost *= Math.exp(-dt / 25);
  R.controls.update();
  const now = performance.now(); let changed = false;
  for (const [id, mk] of Object.entries(UI.marks)) if (mk.until < now){ delete UI.marks[id]; changed = true; }
  if (changed) refreshRings();
  if (UI.sel && G.pins[UI.sel]) G.pins[UI.sel].ring.scale.setScalar(1 + .18 * Math.sin(t / 160));
  setLed('COM', flashState.busy ? Math.floor(t / 110) % 2 === 0 : false);
  if (UI.selWire && UI.selWire.mesh){
    const v = UI.selWire.mesh.mid.clone().project(R.camera), el = $('#stage'), pop = $('#wirepop');
    pop.style.left = ((v.x + 1) / 2 * el.clientWidth) + 'px'; pop.style.top = ((1 - v.y) / 2 * el.clientHeight) + 'px';
  }
  if (Math.floor(t / 500) !== loop.s){ loop.s = Math.floor(t / 500); const tr = $('#tempRead'), on = i2cState().ok; tr.hidden = !on; if (on) tr.textContent = `感測器 ${tempC().toFixed(2)} °C`; }
  R.renderer.render(R.scene, R.camera);
}

/* ---- 主題 ---- */
function themeChanged(){ if (R.scene) R.scene.background = new THREE.Color(sceneBg()); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
new MutationObserver(themeChanged).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });

/* ---- 啟動 ---- */
(async function boot(){
  initTheme();
  wireHooks();
  fillSelects();
  const saved = restore();
  ta.value = saved && typeof saved.code === 'string' ? saved.code : DEFAULT_CODE;
  syncEditor(); renderHint();
  log('按「編譯並燒錄」把 main.c 寫進 STM32H743 的 Flash。快捷鍵 Ctrl/⌘ + S。', 'ld');
  pushLine('— 序列埠已開啟，等待開發板輸出 —', 'sys'); UI.serialUnread = 0; $('#bSerial').hidden = true;
  let ok3d = false;
  {
    try { await Promise.race([Promise.all([document.fonts.load('600 24px "JetBrains Mono"'), document.fonts.load('600 24px "Chakra Petch"')]), new Promise(r => setTimeout(r, 1500))]); } catch (_){}
    try { buildScene($('#stage')); setupPointer(); ok3d = true; } catch (e){ console.error(e); }
  }
  $('#loading').hidden = ok3d;
  if (!ok3d) $('#loading').textContent = '這個裝置無法啟用 3D 畫面（WebGL）。仍可在右側面板接線、檢測、編譯與燒錄。';
  refreshNet();
  const list = saved && Array.isArray(saved.wires) ? saved.wires : SAMPLE.map(x => [...x, null]);
  list.forEach(([a, b, c]) => addWire(a, b, WIRE_COLORS[c] ? c : null, true));
  afterWiring(); setUsb(true); updateButtons();
  if (saved && TABS.includes(saved.tab)) showTab(saved.tab);
  if (ok3d) requestAnimationFrame(loop);
})();
