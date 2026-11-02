// 匯流排模型：I2C 傳輸記錄、UART 輸出、SPI（CS 片選與多個從機）、CAN（MCU 控制器＋收發器模組內建的對端節點）。
// SDK 模擬（hal.js、hal-vendor.js）都經過這裡，邏輯分析儀才看得到每一筆傳輸。
import { bench, SIM, netInfo, level, supply, hasGnd, powered, headerPin, i2cFind, i2cPins, pinListeners } from './sim.js';
import { variantOf } from './parts.js';
import { hooks } from './hooks.js';
import { TRACE, traceI2C, traceUART, traceSPI, traceCAN, edge, tNow, utf8 } from './trace.js';
import { makeSpiDevice } from './spidev.js';
import { pwmReset } from './steppers.js';

/* ---------- UART（printf 經由虛擬序列埠送出） ---------- */
export function uartOut(s){
  if (TRACE.on) traceUART(bench.board.vcp.tx, utf8(s));
  hooks.serial(s);
}

/* ---------- I2C ---------- */
const i2cKeys = () => { const p = i2cPins(); return [p.scl?.mcu, p.sda?.mcu]; };
const findDev = a => { const d = i2cFind(a & 0x7F); return d && d !== 'conflict' ? d.dev : null; };
const tr = segs => { if (TRACE.on){ const [c, d] = i2cKeys(); traceI2C(c, d, segs); } };
export function i2cWrite(addr, bytes){
  const d = findDev(addr), b = bytes.map(x => (Number(x) || 0) & 0xFF);
  tr([{ addr:addr & 0x7F, read:false, bytes:b, nak:!d }]);
  return !!(d && d.tx(b));
}
export function i2cRead(addr, n){
  const d = findDev(addr), data = d ? d.rx(n) : null;
  tr([{ addr:addr & 0x7F, read:true, bytes:data || [], nak:!data }]);
  return data;
}
export function i2cMemRead(addr, reg, n){
  const d = findDev(addr), data = d ? d.read(reg & 0xFF, n) : null;
  tr([{ addr:addr & 0x7F, read:false, bytes:[reg & 0xFF], nak:!d }, { addr:addr & 0x7F, read:true, bytes:data || [], nak:!data }]);
  return data;
}
export function i2cMemWrite(addr, reg, bytes){
  const d = findDev(addr), b = bytes.map(x => (Number(x) || 0) & 0xFF);
  tr([{ addr:addr & 0x7F, read:false, bytes:[reg & 0xFF, ...b], nak:!d }]);
  return !!(d && d.write(reg & 0xFF, b));
}
export function i2cProbe(addr){ const d = findDev(addr); tr([{ addr:addr & 0x7F, read:false, bytes:[], nak:!d }]); return !!d; }
/** 逐位元組讀取的 SDK（MSP430、TivaWare）：先向元件取資料，結束時再依實際讀到的位元組數記錄 */
export function i2cPrefetch(addr, n){ const d = findDev(addr); return d ? d.rx(n) : null; }
export function i2cTraceRead(addr, bytes, nak){ tr([{ addr:addr & 0x7F, read:true, bytes, nak }]); }

/* ---------- SPI ---------- */
export const SPI_TYPES = ['tc', 'flash'];
export const SPI_PINS = { tc:{ sck:'SCK', miso:'SO', mosi:null, cs:'CS' }, flash:{ sck:'CLK', miso:'DO', mosi:'DI', cs:'CS' } };
export function spiPins(){
  const s = bench.board.spi; if (!s) return null;
  const H = l => headerPin(l)?.mcu || null;
  return { sck:H(s.sck), miso:H(s.miso), mosi:H(s.mosi) };
}
export function tcTemp(m){ const t = performance.now() / 1000; return (m.st.tcT ?? SIM.ambient.T) + m.st.boost + Math.sin(t * 1.3 + m.slot) * .12; }
function spiDev(m){
  const v = variantOf(m.type, m.variant);
  if (!m.st.sdev || m.st.sdev.vid !== v.id){ m.st.sdev = makeSpiDevice(v, m.st, () => tcTemp(m), () => SIM.ambient.T + 1.2); m.st.sdev.vid = v.id; m.st.csLow = false; }
  return m.st.sdev;
}
/** 已正確供電並接上 SPI 腳位的從機 */
export function spiDevices(){
  const p = spiPins(); if (!p || !powered()) return [];
  return bench.modules.filter(m => SPI_TYPES.includes(m.type)).filter(m => {
    const v = variantOf(m.type, m.variant), s = supply(`${m.id}.VCC`), N = SPI_PINS[m.type], on = (n, pin) => !n || netInfo(`${m.id}.${n}`).gpio.includes(pin);
    return s >= v.vmin && s <= v.vmax && hasGnd(`${m.id}.GND`) && on(N.sck, p.sck) && on(N.miso, p.miso) && on(N.mosi, p.mosi);
  }).map(m => ({ m, v:variantOf(m.type, m.variant), dev:spiDev(m), csLow:level(`${m.id}.CS`) === 0 }));
}
// CS 腳的電位改變時通知從機（開始／結束一次傳輸）
pinListeners.push(pin => {
  for (const m of bench.modules){
    if (!SPI_TYPES.includes(m.type) || !netInfo(`${m.id}.CS`).gpio.includes(pin)) continue;
    const low = level(`${m.id}.CS`) === 0;
    if (low === !!m.st.csLow) continue;
    m.st.csLow = low; const d = spiDev(m);
    if (low) d.select(); else { d.deselect(); if (TRACE.on){ const p = spiPins(); if (p) edge(p.miso, tNow(), 1, 1); } }
  }
});
/** 主機送出 tx（位元組陣列），同時收回同樣長度的資料 */
export function spiTransfer(tx){
  const bytes = Array.from(tx, x => (Number(x) || 0) & 0xFF), p = spiPins();
  if (!p) return bytes.map(() => 0xFF);
  const sel = spiDevices().filter(d => { if (d.csLow && !d.m.st.csLow){ d.m.st.csLow = true; d.dev.select(); } return d.csLow; });
  const rx = bytes.map(b => sel.reduce((acc, d) => acc & d.dev.xfer(b), 0xFF));   // 兩個從機同時被選中時，MISO 會互相干擾
  if (TRACE.on) traceSPI(p, bytes, rx);
  return rx;
}

/* ---------- CAN ---------- */
export const CAN = { started:false, rx:[], tx:0, txErr:0, objs:{}, mbox:{} };
export function canReset(){ Object.assign(CAN, { started:false, rx:[], tx:0, txErr:0, objs:{}, mbox:{} }); }
export function canPins(){ const c = bench.board.can; if (!c) return null; return { tx:headerPin(c.tx)?.mcu, rx:headerPin(c.rx)?.mcu }; }
export const canModule = () => bench.modules.find(m => m.type === 'can');
export const nodeOfCan = m => m.st.node || (m.st.node = { on:true, cnt:0, next:0, rx:[] });
export function canLink(){
  const p = canPins(), m = canModule(), r = { p, m, powered:false, txOk:false, rxOk:false, ok:false };
  if (!m) return r;
  const v = variantOf(m.type, m.variant), s = supply(`${m.id}.VCC`);
  r.powered = powered() && s >= v.vmin && s <= v.vmax && hasGnd(`${m.id}.GND`);
  if (p){ r.txOk = netInfo(`${m.id}.TXD`).gpio.includes(p.tx); r.rxOk = netInfo(`${m.id}.RXD`).gpio.includes(p.rx); }
  r.ok = r.powered && r.txOk && r.rxOk;
  return r;
}
/** MCU 送出一筆標準格式資料訊框；回傳是否有節點 ACK */
export function canSend(id, data){
  const L = canLink(), node = L.m ? nodeOfCan(L.m) : null, d = Array.from(data, x => (Number(x) || 0) & 0xFF).slice(0, 8);
  const onBus = L.powered && L.txOk, acked = !!(L.ok && node.on);
  if (TRACE.on) traceCAN({ tx:L.p?.tx || bench.board.can && headerPin(bench.board.can.tx)?.mcu, rx: onBus && L.rxOk ? L.p.rx : null, bus: onBus ? 'CAN.BUS' : null }, id & 0x7FF, d, { from:'mcu', ack:acked });
  CAN.tx++;
  if (acked){ node.rx.push({ id:id & 0x7FF, data:d, t:performance.now() }); if (node.rx.length > 20) node.rx.shift(); }
  else CAN.txErr++;
  return acked;
}
/** 對端節點每 500 ms 送出 ID 0x200（2 位元組計數值） */
export function canPoll(){
  const L = canLink(); if (!L.m || !L.powered) return;
  const node = nodeOfCan(L.m), now = performance.now();
  if (!node.on){ node.next = 0; return; }
  if (!node.next || node.next < now - 2000) node.next = now + 500;
  while (node.next <= now){
    node.next += 500; node.cnt = (node.cnt + 1) & 0xFFFF;
    const data = [node.cnt >> 8, node.cnt & 0xFF], mcuAck = L.ok && CAN.started;
    if (TRACE.on) traceCAN({ tx: mcuAck ? L.p.tx : null, rx: L.rxOk ? L.p.rx : null, bus:'CAN.BUS' }, 0x200, data, { from:'node', ack:mcuAck, mcuAck });
    if (mcuAck){ CAN.rx.push({ id:0x200, data }); if (CAN.rx.length > 16) CAN.rx.shift(); }
  }
}
export function canPending(){ canPoll(); return CAN.started ? CAN.rx.length : 0; }
export function canRecv(){ canPoll(); return CAN.started ? CAN.rx.shift() || null : null; }

/** 程式重新開始時：清除 MCU 控制器狀態（Flash 內容與節點計數保留） */
export function resetBuses(){ canReset(); pwmReset(); for (const m of bench.modules) if (SPI_TYPES.includes(m.type)){ m.st.csLow = false; m.st.sdev = null; } }
