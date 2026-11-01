// I2C 感測器的暫存器／指令模型，依各型號 datasheet 的資料格式回傳數值。
// 介面：{ addr, read(reg, n), write(reg, bytes), tx(bytes), rx(n) }，失敗（NACK）時回傳 null 或 false。

const now = () => performance.now();
const be16 = v => [(v >> 8) & 0xFF, v & 0xFF];

export function crc8(bytes){
  let c = 0xFF;
  for (const b of bytes){ c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xFF : (c << 1) & 0xFF; }
  return c;
}

/* ---- BMP280 / BME280：datasheet 範例校正值與 32 位元整數補償公式 ---- */
const T1 = 27504, T2 = 26435, T3 = -1000;
export function bmxCompensate(adc){
  const var1 = (((adc >> 3) - (T1 << 1)) * T2) >> 11;
  const var2 = (((((adc >> 4) - T1) * ((adc >> 4) - T1)) >> 12) * T3) >> 14;
  return ((var1 + var2) * 5 + 128) >> 8;   // 0.01 °C
}
function bmxRaw(tempC){
  const want = Math.round(tempC * 100); let lo = 0, hi = 0xFFFFF;
  while (lo < hi){ const mid = (lo + hi) >> 1; if (bmxCompensate(mid) < want) lo = mid + 1; else hi = mid; }
  return lo;
}

export function makeDevice(v, readT, readRH){
  const addr = v.addr;
  switch (v.dev){
    case 'bmx280': {
      const regs = { 0xF4:0x00, 0xF5:0x00, 0xF2:0x00 }; let ptr = 0;
      const calib = [T1 & 0xFF, T1 >> 8, T2 & 0xFF, (T2 >> 8) & 0xFF, T3 & 0xFF, (T3 >> 8) & 0xFF];
      const byteAt = r => {
        if (r === 0xD0) return v.chipId;
        if (r >= 0x88 && r <= 0x8D) return calib[r - 0x88];
        if (r >= 0x8E && r <= 0x9F) return 0x00;
        if (r === 0xF3) return 0x00;
        if (r in regs) return regs[r];
        if (r >= 0xF7 && r <= 0xF9) return [0x65, 0x5A, 0xC0][r - 0xF7];
        if (r >= 0xFA && r <= 0xFC){
          if ((regs[0xF4] & 0x03) === 0) return [0x80, 0x00, 0x00][r - 0xFA];   // 睡眠模式：重置值
          const raw = bmxRaw(readT());
          return [(raw >> 12) & 0xFF, (raw >> 4) & 0xFF, (raw & 0x0F) << 4][r - 0xFA];
        }
        if (r === 0xFD || r === 0xFE) return r === 0xFD ? 0x80 : 0x00;
        return 0x00;
      };
      return {
        addr,
        read:(reg, n) => Array.from({ length:n }, (_, i) => byteAt(reg + i)),
        write:(reg, bytes) => { bytes.forEach((b, i) => { regs[reg + i] = b & 0xFF; }); return true; },
        tx:bytes => { if (!bytes.length) return true; ptr = bytes[0]; bytes.slice(1).forEach((b, i) => { regs[ptr + i] = b & 0xFF; }); return true; },
        rx:n => Array.from({ length:n }, (_, i) => byteAt(ptr + i)),
      };
    }
    case 'lm75':
    case 'tmp102':
    case 'mcp9808':
    case 'hdc1080': {
      let ptr = 0, pending = null;
      const word = r => {
        const t = readT();
        if (v.dev === 'lm75') return r === 0 ? ((Math.round(t / 0.125) & 0x7FF) << 5) : r === 1 ? 0x0000 : 0x4B00;
        if (v.dev === 'tmp102') return r === 0 ? ((Math.round(t / 0.0625) & 0xFFF) << 4) : r === 1 ? 0x60A0 : 0x4B00;
        if (v.dev === 'mcp9808') return r === 5 ? (Math.round(t * 16) & 0x1FFF) : r === 6 ? 0x0054 : r === 7 ? 0x0400 : r === 1 ? 0x0000 : 0x0000;
        if (r === 0xFE) return 0x5449; if (r === 0xFF) return 0x1050; if (r === 0x02) return 0x1000;
        return 0;
      };
      return {
        addr,
        read:(reg, n) => { const b = be16(word(reg)); return Array.from({ length:n }, (_, i) => b[i] ?? 0); },
        write:() => true,
        tx:bytes => {
          if (!bytes.length) return true;
          ptr = bytes[0];
          if (v.dev === 'hdc1080' && (ptr === 0x00 || ptr === 0x01)) pending = { reg:ptr, t:now() };
          return true;
        },
        rx:n => {
          let w;
          if (v.dev === 'hdc1080' && pending){
            if (now() - pending.t < 6.5) return null;   // 轉換未完成會回 NACK
            w = pending.reg === 0 ? Math.round((readT() + 40) / 165 * 65536) & 0xFFFC : Math.round(readRH() / 100 * 65536) & 0xFFFC;
          } else w = word(ptr);
          const b = be16(w); return Array.from({ length:n }, (_, i) => b[i] ?? 0);
        },
      };
    }
    case 'sht3x': {
      let pending = null, status = false;
      return {
        addr,
        read:() => null, write:() => false,
        tx:bytes => {
          const cmd = ((bytes[0] << 8) | (bytes[1] ?? 0)) & 0xFFFF;
          status = cmd === 0xF32D;
          if (cmd === 0x2400 || cmd === 0x2C06 || cmd === 0x240B || cmd === 0x2416) pending = now();
          return true;
        },
        rx:n => {
          if (status){ status = false; const s = [0x80, 0x10]; return [...s, crc8(s)].slice(0, n); }
          if (pending === null || now() - pending < 15) return null;
          pending = null;
          const t = be16(Math.round((readT() + 45) / 175 * 65535) & 0xFFFF), h = be16(Math.round(readRH() / 100 * 65535) & 0xFFFF);
          return [...t, crc8(t), ...h, crc8(h)].slice(0, n);
        },
      };
    }
    case 'aht20': {
      let started = null;
      return {
        addr,
        read:() => null, write:() => false,
        tx:bytes => { if (bytes[0] === 0xAC) started = now(); return true; },
        rx:n => {
          const busy = started !== null && now() - started < 75;
          if (started === null || busy) return Array.from({ length:n }, (_, i) => i === 0 ? (busy ? 0x9C : 0x1C) : 0);
          const h = Math.round(readRH() / 100 * 1048576) & 0xFFFFF, t = Math.round((readT() + 50) / 200 * 1048576) & 0xFFFFF;
          const d = [0x1C, (h >> 12) & 0xFF, (h >> 4) & 0xFF, ((h & 0x0F) << 4) | ((t >> 16) & 0x0F), (t >> 8) & 0xFF, t & 0xFF];
          return [...d, crc8(d)].slice(0, n);
        },
      };
    }
  }
  return { addr, read:() => null, write:() => false, tx:() => false, rx:() => null };
}
