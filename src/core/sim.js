// 接線資料與電氣模擬（網路、短路、GPIO 讀值、LED、I2C）
import { PINS, nodeOf, isGpioName } from './board.js';
import { hooks } from './hooks.js';

export let wires = [], wireSeq = 0, NET = null;
export const SIM = { usb:true, flashed:null, out:{}, mode:{}, b1:false, btn:false, senDamaged:false, tempBoost:0, run:'idle' };

export function autoColor(a, b){
  const n = [PINS[a].name, PINS[b].name];
  if (n.some(x => x === '3V3' || x === '5V' || x === 'VCC')) return 'red';
  if (n.includes('GND')) return 'black';
  if (n.includes('SCL')) return 'yellow';
  if (n.includes('SDA')) return 'blue';
  return ['green', 'orange', 'white', 'purple'][wires.length % 4];
}
export function wireOf(pinId){ return wires.find(w => w.a === pinId || w.b === pinId); }
export function addWire(a, b, color, quiet){
  if (!PINS[a] || !PINS[b]) return false;
  if (a === b){ hooks.toast('起點和終點是同一支腳位。'); return false; }
  for (const p of [a, b]) if (wireOf(p)){ hooks.toast(`${PINS[p].label} 已經插了一條杜邦線，先拔除再接。`); return false; }
  if (PINS[a].group !== 'board' && PINS[a].group === PINS[b].group){ hooks.toast('同一個模組的兩支腳不需要互接，這會讓它短路。'); return false; }
  const w = { id:++wireSeq, a, b, color: color || autoColor(a, b), bend:(Math.random() * 2 - 1) * 3.2 };
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

/* ================= 電氣網路 ================= */
export function netMap(){
  const parent = {};
  const f = k => { if (!(k in parent)) parent[k] = k; while (parent[k] !== k){ parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  for (const w of wires){ const a = f(nodeOf(w.a)), b = f(nodeOf(w.b)); if (a !== b) parent[a] = b; }
  const groups = {}; for (const k of Object.keys(parent)){ const r = f(k); (groups[r] = groups[r] || []).push(k); }
  return { f, groups };
}
export function net(k){ const g = NET.groups[NET.f(k)]; return g || [k]; }
export function netInfo(k){
  const m = net(k);
  return { m, v33:m.includes('3V3'), v5:m.includes('5V'), gnd:m.includes('GND'), gpio:m.filter(isGpioName), mods:m.filter(x => x.includes('.')) };
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
export function btnPowered(){ const v = netInfo('BTN.VCC'), g = netInfo('BTN.GND'); return (v.v33 || v.v5) && g.gnd; }
export function readPin(p){
  if (p === 'PC13') return SIM.b1 ? 1 : 0;
  const i = netInfo(p);
  if (i.v33 || i.v5) return 1;
  if (i.gnd) return 0;
  for (const g of i.gpio) if (g !== p && SIM.mode[g] === 'out') return SIM.out[g] ? 1 : 0;
  if (i.m.includes('BTN.OUT') && btnPowered()) return SIM.btn ? 1 : 0;
  if (SIM.mode[p] === 'out') return SIM.out[p] ? 1 : 0;
  return 0; // 浮接：MX_GPIO_Init 預設下拉
}
export function ledOn(){
  if (!powered()) return false;
  if (!netInfo('LED.GND').gnd) return false;
  const s = netInfo('LED.SIG');
  if (s.gnd) return false;
  if (s.v33 || s.v5) return true;
  if (s.m.includes('BTN.OUT') && btnPowered()) return SIM.btn;
  return s.gpio.some(p => SIM.mode[p] === 'out' && SIM.out[p]);
}
export function i2cState(){
  if (!powered()) return { ok:false, why:'off' };
  if (SIM.senDamaged) return { ok:false, why:'damaged' };
  const v = netInfo('SEN.VCC'), g = netInfo('SEN.GND'), c = netInfo('SEN.SCL'), d = netInfo('SEN.SDA');
  if (!(v.v33 || v.v5) || !g.gnd) return { ok:false, why:'nopower' };
  if (!c.gpio.includes('PB8') || !d.gpio.includes('PB9')) return { ok:false, why:'bus' };
  return { ok:true };
}
export function tempC(){ const t = performance.now() / 1000; return 24.6 + .35 * Math.sin(t / 23) + .06 * Math.sin(t * 1.7) + SIM.tempBoost; }
export function senReg(reg){
  const raw = Math.round(tempC() * 100) & 0xFFFF;
  return ({ 0xD0:0x60, 0xF3:0x00, 0xFA:raw >> 8, 0xFB:raw & 0xFF })[reg] ?? 0;
}


export function refreshNet(){ NET = netMap(); return NET; }
NET = netMap();
