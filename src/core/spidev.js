// SPI 元件模型（依 datasheet 的資料格式）：MAX6675、MAX31855K 熱電偶放大器，W25Q32JV／W25Q128JV SPI Flash。
// 介面：select()＝CS 拉低、xfer(送出的位元組) → 收到的位元組、deselect()＝CS 拉高。
// st 是模組狀態（m.st）：tcT 熱電偶溫度、open 熱電偶斷線、mem／wel／busyUntil 是 Flash 的內容與狀態（斷電不會消失）。

export function makeSpiDevice(v, st, readT, readCJ){
  switch (v.dev){
    case 'max6675': {
      // 16 位元：D15 恆為 0、D14..D3 溫度（0.25 °C）、D2 熱電偶斷線、D1 裝置 ID（0）、D0 三態
      let sh = 0;
      return {
        select(){ const t = Math.max(0, Math.min(1023.75, readT())); sh = st.open ? 0x0004 : ((Math.round(t * 4) & 0xFFF) << 3); },
        xfer(){ const out = (sh >> 8) & 0xFF; sh = (sh << 8) & 0xFFFF; return out; },
        deselect(){},
      };
    }
    case 'max31855': {
      // 32 位元：D31..D18 熱電偶溫度（14 位元有號，0.25 °C）、D16 故障、D15..D4 冷接點溫度（12 位元有號，0.0625 °C）、D0 斷線
      let sh = 0;
      return {
        select(){
          const tc = Math.round(Math.max(-270, Math.min(1800, readT())) * 4) & 0x3FFF, cj = Math.round(readCJ() * 16) & 0xFFF;
          sh = st.open ? (((cj << 4) | 0x00010001) >>> 0) : (((tc << 18) | (cj << 4)) >>> 0);
        },
        xfer(){ const out = (sh >>> 24) & 0xFF; sh = (sh << 8) >>> 0; return out; },
        deselect(){},
      };
    }
    case 'w25q': {
      if (!st.mem) st.mem = new Map();
      const mask = v.bytes - 1, mem = st.mem;
      let cmd = null, n = 0, addr = 0, buf = [];
      const busy = () => performance.now() < (st.busyUntil || 0);
      return {
        select(){ cmd = null; n = 0; addr = 0; buf = []; },
        xfer(b){
          if (cmd === null){ cmd = busy() && b !== 0x05 ? -1 : b; return 0xFF; }   // 忙碌中只接受「讀狀態」指令
          n++;
          switch (cmd){
            case 0x9F: return [0xEF, 0x40, v.cap][n - 1] ?? 0xFF;                   // JEDEC ID：製造商 Winbond、記憶體類型、容量
            case 0x05: return (busy() ? 1 : 0) | (st.wel ? 2 : 0);                   // 狀態暫存器 1：BUSY、WEL
            case 0x35: return 0x00;
            case 0xAB: return n <= 3 ? 0xFF : v.did;
            case 0x90: return n <= 3 ? 0xFF : (n % 2 ? v.did : 0xEF);
            case 0x03: case 0x0B: {
              const hdr = cmd === 0x0B ? 4 : 3;
              if (n <= 3){ addr = ((addr << 8) | b) & mask; return 0xFF; }
              if (n <= hdr) return 0xFF;
              return mem.get((addr + n - hdr - 1) & mask) ?? 0xFF;
            }
            case 0x02: if (n <= 3) addr = ((addr << 8) | b) & mask; else buf.push(b & 0xFF); return 0xFF;
            case 0x20: case 0x52: case 0xD8: if (n <= 3) addr = ((addr << 8) | b) & mask; return 0xFF;
          }
          return 0xFF;
        },
        deselect(){
          const now = performance.now();
          if (cmd === 0x06) st.wel = true;
          else if (cmd === 0x04) st.wel = false;
          else if (cmd === 0x02 && st.wel && n >= 4){
            // 頁寫入：只能把 1 寫成 0（所以寫之前要先抹除）；超過頁尾會繞回同一頁的開頭
            const page = addr & ~0xFF;
            buf.slice(0, 256).forEach((x, k) => { const a = page | ((addr + k) & 0xFF); mem.set(a, (mem.get(a) ?? 0xFF) & x); });
            st.wel = false; st.busyUntil = now + 0.7;
          } else if ((cmd === 0x20 || cmd === 0x52 || cmd === 0xD8) && st.wel && n >= 3){
            const size = cmd === 0x20 ? 4096 : cmd === 0x52 ? 32768 : 65536, base = addr & ~(size - 1);
            for (const a of [...mem.keys()]) if (a >= base && a < base + size) mem.delete(a);
            st.wel = false; st.busyUntil = now + (cmd === 0x20 ? 45 : 150);
          } else if ((cmd === 0xC7 || cmd === 0x60) && st.wel){ mem.clear(); st.wel = false; st.busyUntil = now + 800; }
          cmd = null;
        },
      };
    }
  }
  return { select(){}, xfer:() => 0xFF, deselect(){} };
}
