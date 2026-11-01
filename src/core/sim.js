// 工作台狀態（開發板、模組、杜邦線）與電氣模擬
import { BOARD_BY_ID, DEFAULT_BOARD, pinTitle } from './boards.js';
import { MODULE_TYPES, variantOf, RAIL_HOLES, MAX_MODULES } from './parts.js';
import { makeDevice } from './devices.js';
import { hooks } from './hooks.js';
import { setTrace, traceGpio } from './trace.js';

export const SIM = { usb:true, flashed:null, out:{}, mode:{}, run:'idle', b1:false, ambient:{ T:24.6, RH:55 } };
export const bench = { board:BOARD_BY_ID[DEFAULT_BOARD], modules:[] };
export let PINS = {}, PIN_ORDER = [], NET = null;
export let wires = [];
let wireSeq = 0, modSeq = 0;

/** 網路節點中，除了電源、地、電源軌與模組腳位以外的都是 MCU 腳位（PA5、P1.0、PTB22、GPIO31、PIO1_4…） */
export const isGpioName = s => !['3V3', '5V', 'GND', 'RAIL+', 'RAIL-'].includes(s) && !/^M\d+\./.test(s);
const freshState = () => ({ pressed:false, pot:.42, motionUntil:0, boost:0, damaged:false, dev:null, tcT:null, open:false });
export const isAnalyzer = m => /^la_/.test(m.type);
/** 工作台上有邏輯分析儀時才記錄訊號 */
const syncTrace = () => setTrace(bench.modules.some(isAnalyzer));

/* ---------- GPIO 輸出（所有 SDK 都經過這裡，邏輯分析儀與 SPI 片選才看得到） ---------- */
export const pinListeners = [];
export function pinWrite(p, v){
  SIM.mode[p] = 'out'; const nv = v ? 1 : 0;
  if (SIM.out[p] === nv) return;
  SIM.out[p] = nv; traceGpio(p, nv);
  for (const f of pinListeners) f(p, nv);
}
export const pinToggle = p => pinWrite(p, !SIM.out[p]);

/* ---------- 腳位登錄 ---------- */
function gpioFunc(h){
  const f = [];
  if (h.tags.includes('scl')) f.push(`${bench.board.i2c.bus}_SCL`);
  if (h.tags.includes('sda')) f.push(`${bench.board.i2c.bus}_SDA`);
  if (h.tags.includes('adc')) f.push('ADC 類比輸入');
  if (h.tags.includes('pwm')) f.push('PWM');
  if (h.tags.includes('vcp')) f.push(`${bench.board.vcp.periph} 虛擬序列埠${h.mcu === bench.board.vcp.tx ? ' TX' : ' RX'}`);
  for (const [t, n] of [['sck', 'SCK'], ['miso', 'MISO'], ['mosi', 'MOSI']]) if (h.tags.includes(t)) f.push(`${bench.board.spi.bus}_${n}`);
  if (h.tags.includes('cantx')) f.push(`${bench.board.can.bus}_TX`);
  if (h.tags.includes('canrx')) f.push(`${bench.board.can.bus}_RX`);
  if (h.tags.includes('led')) f.push('接板載 LED');
  return f.length ? f.join(' · ') : 'GPIO';
}
export function moduleLabel(m){
  const T = MODULE_TYPES[m.type], same = bench.modules.filter(x => x.type === m.type);
  return same.length > 1 ? `${T.short} ${same.indexOf(m) + 1}` : T.short;
}
export function rebuildPins(){
  const P = {}, order = [];
  const add = p => { P[p.id] = p; order.push(p.id); };
  bench.board.header.forEach((h, i) => add({ id:h.id, group:'board', name:h.label, kind:h.kind, mcu:h.mcu, tags:h.tags, index:i, label:pinTitle(h),
    func: h.kind === 'gnd' ? '接地' : h.kind === 'pwr' ? (h.label === '5V' ? '5 V 電源輸出（USB）' : '3.3 V 電源輸出') : gpioFunc(h) }));
  for (const s of ['+', '-']) for (let k = 1; k <= RAIL_HOLES; k++)
    add({ id:`R.${s}${k}`, group:'rail', name:s, kind:'rail', index:k - 1, label:`電源軌 ${s === '+' ? '+' : '−'}${k}`, func: s === '+' ? '電源軌正極（所有 + 孔相通）' : '電源軌負極（所有 − 孔相通）' });
  for (const m of bench.modules) MODULE_TYPES[m.type].pins.forEach(([n, f], j) =>
    add({ id:`${m.id}.${n}`, group:m.id, name:n, kind:'mod', func:f, index:j, label:`${moduleLabel(m)} ${n}` }));
  PINS = P; PIN_ORDER = order;
}
export function nodeOf(id){
  const p = PINS[id]; if (!p) return id;
  if (p.group === 'board') return p.kind === 'gpio' ? p.mcu : p.kind === 'gnd' ? 'GND' : p.name;
  if (p.group === 'rail') return p.name === '+' ? 'RAIL+' : 'RAIL-';
  return id;
}
export const moduleById = id => bench.modules.find(m => m.id === id);
export const headerPin = label => bench.board.header.find(h => h.label === label);

/* ---------- 開發板與模組 ---------- */
export function setBoard(id, quiet){
  const b = BOARD_BY_ID[id]; if (!b) return 0;
  bench.board = b; rebuildPins();
  const before = wires.length; pruneWires();
  SIM.out = {}; SIM.mode = {};
  if (!quiet) hooks.benchChanged();
  return before - wires.length;
}
export function addModule(type, variant, quiet, fixed){
  if (bench.modules.length >= MAX_MODULES || !MODULE_TYPES[type]) return null;
  const used = new Set(bench.modules.map(m => m.slot)); let slot = 0; while (used.has(slot)) slot++;
  if (fixed && fixed.slot >= 0 && fixed.slot < MAX_MODULES && !used.has(fixed.slot)) slot = fixed.slot;
  let id = 'M' + (++modSeq);
  if (fixed && /^M\d+$/.test(fixed.id) && !moduleById(fixed.id)){ id = fixed.id; modSeq = Math.max(modSeq, +id.slice(1)); }
  const m = { id, type, variant:variantOf(type, variant).id, slot, st:freshState() };
  bench.modules.push(m); rebuildPins(); syncTrace();
  if (!quiet) hooks.benchChanged();
  return m;
}
export function removeModule(id, quiet){
  const i = bench.modules.findIndex(m => m.id === id); if (i < 0) return;
  bench.modules.splice(i, 1); rebuildPins(); pruneWires(); syncTrace();
  if (!quiet) hooks.benchChanged();
}
export function setVariant(id, vid){
  const m = moduleById(id); if (!m) return;
  m.variant = variantOf(m.type, vid).id; m.st = freshState();
  hooks.benchChanged();
}
export function resetBench(){ wires.forEach(w => hooks.wireRemoved(w)); wires = []; bench.modules = []; modSeq = 0; rebuildPins(); NET = netMap(); syncTrace(); }

/* ---------- 杜邦線 ---------- */
export function autoColor(a, b){
  const n = [PINS[a].name, PINS[b].name];
  if (n.some(x => x === '3V3' || x === '5V' || x === 'VCC' || x === '+')) return 'red';
  if (n.some(x => x === 'GND' || x === '-')) return 'black';
  if (n.includes('SCL')) return 'yellow';
  if (n.includes('SDA')) return 'blue';
  return ['green', 'orange', 'white', 'purple'][wires.length % 4];
}
export const wireOf = id => wires.find(w => w.a === id || w.b === id);
export const wiresOf = id => wires.filter(w => w.a === id || w.b === id);
/** 排針與電源軌每孔只能插一條線；模組腳位可插兩條（方便串接 I2C 等匯流排） */
export const maxWires = id => PINS[id]?.kind === 'mod' ? 2 : 1;
export function addWire(a, b, color, quiet){
  if (!PINS[a] || !PINS[b]) return false;
  if (a === b){ hooks.toast('起點和終點是同一支腳位。'); return false; }
  if (wires.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))){ hooks.toast('這兩支腳已經接在一起了。'); return false; }
  for (const p of [a, b]) if (wiresOf(p).length >= maxWires(p)){ hooks.toast(maxWires(p) > 1 ? `${PINS[p].label} 已經插了兩條線。` : `${PINS[p].label} 已經插了一條杜邦線，先拔除再接。`); return false; }
  if (PINS[a].kind === 'mod' && PINS[a].group === PINS[b].group){ hooks.toast('同一個模組的兩支腳不需要互接，這會讓它短路。'); return false; }
  const w = { id:++wireSeq, a, b, color:color || autoColor(a, b), bend:(Math.random() * 2 - 1) * 3.2 };
  wires.push(w); hooks.wireAdded(w);
  if (!quiet) hooks.afterWiring();
  return w;
}
export function removeWire(w, quiet){
  const i = wires.indexOf(w); if (i < 0) return;
  wires.splice(i, 1); hooks.wireRemoved(w);
  if (!quiet) hooks.afterWiring();
}
export function clearWires(quiet){ [...wires].forEach(w => removeWire(w, true)); if (!quiet) hooks.afterWiring(); }
function pruneWires(){ [...wires].filter(w => !PINS[w.a] || !PINS[w.b]).forEach(w => removeWire(w, true)); }

/* ---------- 電氣網路 ---------- */
export function netMap(){
  const parent = {};
  const f = k => { if (!(k in parent)) parent[k] = k; while (parent[k] !== k){ parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  for (const w of wires){ const a = f(nodeOf(w.a)), b = f(nodeOf(w.b)); if (a !== b) parent[a] = b; }
  const groups = {}; for (const k of Object.keys(parent)){ const r = f(k); (groups[r] = groups[r] || []).push(k); }
  return { f, groups };
}
export function refreshNet(){ NET = netMap(); return NET; }
export function net(k){ return NET.groups[NET.f(k)] || [k]; }
export function netInfo(k){
  const m = net(k);
  return { m, v33:m.includes('3V3'), v5:m.includes('5V'), gnd:m.includes('GND'), gpio:m.filter(isGpioName), mods:m.filter(x => /^M\d+\./.test(x)) };
}
export function shorts(){
  const out = [];
  for (const ms of Object.values(NET.groups)){
    const s = new Set(ms);
    if ((s.has('3V3') || s.has('5V')) && s.has('GND')) out.push({ type:'gnd', ms });
    else if (s.has('3V3') && s.has('5V')) out.push({ type:'rails', ms });
  }
  return out;
}
export const powered = () => SIM.usb && shorts().length === 0;
export function supply(node){ if (!powered()) return 0; const i = netInfo(node); return i.v5 ? 5 : i.v33 ? 3.3 : 0; }
export const hasGnd = node => netInfo(node).gnd;
const pinOf = (m, n) => `${m.id}.${n}`;

/** 模組輸出腳的電位（按鈕、PIR），沒有驅動時回傳 null */
function moduleDrive(pinId){
  const [id, n] = pinId.split('.'); const m = moduleById(id); if (!m) return null;
  if (m.type === 'button' && n === 'OUT') return supply(pinOf(m, 'VCC')) && hasGnd(pinOf(m, 'GND')) ? (m.st.pressed ? 1 : 0) : null;
  if (m.type === 'pir' && n === 'OUT'){
    const v = supply(pinOf(m, 'VCC')); if (!v || !hasGnd(pinOf(m, 'GND'))) return null;
    return v >= variantOf(m.type, m.variant).vmin && performance.now() < m.st.motionUntil ? 1 : 0;
  }
  return null;
}
/** 某個節點所在網路的邏輯電位：1、0，或浮接 null。exclude 是正在讀取的 GPIO 本身 */
export function level(node, exclude){
  if (!powered()) return null;
  const i = netInfo(node);
  if (i.v33 || i.v5) return 1;
  if (i.gnd) return 0;
  for (const g of i.gpio) if (g !== exclude && SIM.mode[g] === 'out') return SIM.out[g] ? 1 : 0;
  for (const mp of i.mods){ const v = moduleDrive(mp); if (v !== null) return v; }
  return null;
}
export function readPin(p){
  const b = bench.board;
  if (b.btn && p === b.btn.pin) return SIM.b1 ? (b.btn.activeLow ? 0 : 1) : (b.btn.activeLow ? 1 : 0);
  const v = level(p, p);
  if (v !== null) return v;
  if (SIM.mode[p] === 'out') return SIM.out[p] ? 1 : 0;
  return 0;
}
export function boardLedOn(led){ return powered() && SIM.mode[led.pin] === 'out' && (led.activeLow ? !SIM.out[led.pin] : !!SIM.out[led.pin]); }

export function moduleState(m){
  const v = variantOf(m.type, m.variant), P = n => pinOf(m, n), hi = n => level(P(n)) === 1, gnd = n => hasGnd(P(n));
  switch (m.type){
    case 'led': return { on: hi('SIG') && gnd('GND') };
    case 'rgb': return { r: hi('R') && gnd('GND'), g: hi('G') && gnd('GND'), b: hi('B') && gnd('GND') };
    case 'buzzer': return { on: hi('SIG') && gnd('GND') };
    case 'relay': { const s = supply(P('VCC')); return { on: s >= v.vmin && gnd('GND') && hi('IN'), weak: s > 0 && s < v.vmin }; }
    case 'pir': return { active: moduleDrive(P('OUT')) === 1 };
    case 'pot': return { value:m.st.pot };
    case 'button': return { pressed:m.st.pressed };
    case 'temp': return { ok:i2cDevices().some(d => d.m === m), damaged:m.st.damaged };
  }
  return {};
}

/* ---------- 類比（ADC） ---------- */
export function analogVolts(node){
  if (!powered()) return 0;
  const i = netInfo(node);
  if (i.v5) return 5; if (i.v33) return 3.3; if (i.gnd) return 0;
  for (const mp of i.mods){
    const [id, n] = mp.split('.'); const m = moduleById(id);
    if (m && m.type === 'pot' && n === 'OUT'){ const s = supply(pinOf(m, 'VCC')); if (s && hasGnd(pinOf(m, 'GND'))) return s * m.st.pot; }
  }
  for (const g of i.gpio) if (SIM.mode[g] === 'out') return SIM.out[g] ? 3.3 : 0;
  return null;
}
/** hadc1 讀值（簡化）：取第一個接了訊號的 ADC 腳，12 位元 */
export function adcRead(){
  for (const h of bench.board.header){
    if (!h.tags.includes('adc')) continue;
    const v = analogVolts(h.mcu);
    if (v !== null && net(h.mcu).length > 1) return Math.max(0, Math.min(4095, Math.round(Math.min(v, 3.3) / 3.3 * 4095 + (Math.random() - .5) * 6)));
  }
  return 0;
}

/* ---------- I2C ---------- */
export function sensorTemp(m){ const v = variantOf(m.type, m.variant), t = performance.now() / 1000; return SIM.ambient.T + m.st.boost + v.bias + v.noise * (Math.sin(t * 1.7 + m.slot) + Math.sin(t * .31) * .6); }
export function sensorRH(m){ const t = performance.now() / 1000; return Math.max(0, Math.min(100, SIM.ambient.RH - m.st.boost * 1.8 + Math.sin(t / 9 + m.slot) * .4)); }
export function i2cPins(){ const b = bench.board; return { scl:headerPin(b.i2c.scl), sda:headerPin(b.i2c.sda) }; }
export function i2cDevices(){
  if (!powered()) return [];
  const { scl, sda } = i2cPins(); if (!scl || !sda) return [];
  return bench.modules.filter(m => m.type === 'temp' && !m.st.damaged && supply(pinOf(m, 'VCC')) && hasGnd(pinOf(m, 'GND'))
    && netInfo(pinOf(m, 'SCL')).gpio.includes(scl.mcu) && netInfo(pinOf(m, 'SDA')).gpio.includes(sda.mcu))
    .map(m => {
      const v = variantOf(m.type, m.variant);
      if (!m.st.dev || m.st.dev.vid !== v.id){ m.st.dev = makeDevice(v, () => sensorTemp(m), () => sensorRH(m)); m.st.dev.vid = v.id; }
      return { m, v, addr:v.addr, dev:m.st.dev };
    });
}
/** 找到該 7 位元位址的裝置；位址衝突時回傳 'conflict' */
export function i2cFind(addr7){
  const list = i2cDevices().filter(d => d.addr === addr7);
  return list.length > 1 ? 'conflict' : list[0] || null;
}

/** 接線或供電改變後檢查會損壞的元件，回傳新損壞的模組 */
export function checkDamage(){
  const out = [];
  if (!powered()) return out;
  for (const m of bench.modules){
    if (m.type !== 'temp' || m.st.damaged) continue;
    const v = variantOf(m.type, m.variant);
    if (supply(pinOf(m, 'VCC')) > v.vmax && hasGnd(pinOf(m, 'GND'))){ m.st.damaged = true; out.push(m); }
  }
  return out;
}
export function tickSim(dt){ for (const m of bench.modules) if (m.st.boost) m.st.boost *= Math.exp(-dt / 25); }

rebuildPins(); NET = netMap();
