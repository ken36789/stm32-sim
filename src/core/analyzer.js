// 邏輯分析儀：探棒接到哪條線、擷取一段時間的訊號、依取樣率量化後解碼，並找出「為什麼波形會變這樣」。
import { bench, net, netInfo, isGpioName, moduleById, wiresOf, moduleLabel } from './sim.js';
import { MODULE_TYPES, variantOf } from './parts.js';
import { snapshot, lastActivity, tNow } from './trace.js';
import { decodeI2C, decodeUART, decodeSPI, decodeCAN, sampleSig, constSig, minPulse, STD_BAUD, hex2 } from './protocols.js';
import { spiPins, canPins, SPI_TYPES } from './buses.js';

export const RATES = [100e6, 50e6, 24e6, 12e6, 4e6, 2e6, 1e6, 500e3, 250e3, 100e3, 50e3];
export const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400];
export const CAN_RATES = [125e3, 250e3, 500e3, 1e6];
export const protoOf = m => MODULE_TYPES[m.type]?.analyzer || null;
const IDLE = { i2c:{ SCL:1, SDA:1 }, uart:{ TX:1, RX:1 }, spi:{ SCK:0, MOSI:0, MISO:1, CS:1 }, can:{ CANH:1, CANL:1 } };

const pinName = mcu => { const h = bench.board.header.find(x => x.mcu === mcu); return h && h.label !== mcu ? `${h.label}（${mcu}）` : mcu; };
/** 這支 MCU 腳位在本板上的功能（給使用者看的說明） */
export function lineRole(mcu){
  const b = bench.board, H = l => b.header.find(h => h.label === l)?.mcu, r = [];
  if (mcu === H(b.i2c.scl)) r.push(`${b.i2c.bus} SCL`);
  if (mcu === H(b.i2c.sda)) r.push(`${b.i2c.bus} SDA`);
  if (mcu === b.vcp.tx) r.push(`${b.vcp.periph} TX`);
  if (mcu === b.vcp.rx) r.push(`${b.vcp.periph} RX`);
  const sp = spiPins(); if (sp){ if (mcu === sp.sck) r.push(`${b.spi.bus} SCK`); if (mcu === sp.miso) r.push(`${b.spi.bus} MISO`); if (mcu === sp.mosi) r.push(`${b.spi.bus} MOSI`); }
  const cp = canPins(); if (cp){ if (mcu === cp.tx) r.push(`${b.can.bus} TX`); if (mcu === cp.rx) r.push(`${b.can.bus} RX`); }
  for (const m of bench.modules) if (SPI_TYPES.includes(m.type) && netInfo(`${m.id}.CS`).gpio.includes(mcu)) r.push(`${moduleLabel(m)} 的 CS`);
  return r.join('、') || 'GPIO';
}

/** 探棒接到哪裡：{ kind:'line'|'const'|'open'|'float', key, xform, label } */
export function probeSource(m, n){
  const id = `${m.id}.${n}`;
  if (!wiresOf(id).length) return { kind:'open', label:'沒有接' };
  const ms = net(id);
  if (ms.includes('GND')) return { kind:'const', v:0, label:'GND（固定低電位）' };
  if (ms.includes('3V3') || ms.includes('5V')) return { kind:'const', v:1, label:`${ms.includes('5V') ? '5V' : '3V3'}（固定高電位）` };
  const can = ms.find(x => /^M\d+\.CAN[HL]$/.test(x) && moduleById(x.split('.')[0])?.type === 'can');
  if (can) return { kind:'line', key:'CAN.BUS', xform:can.slice(-1), label:`CAN 匯流排 ${can.slice(-4)}` };
  const g = ms.filter(isGpioName)[0];
  if (g) return { kind:'line', key:g, label:`${pinName(g)} · ${lineRole(g)}`, pin:g };
  return { kind:'float', label:'只接到模組，沒有連到開發板' };
}
/** 這根探棒「應該」接到哪條線 */
export function expectedSource(m, n){
  const b = bench.board, H = l => b.header.find(h => h.label === l)?.mcu, sp = spiPins();
  switch (m.type){
    case 'la_i2c': return { key: n === 'SCL' ? H(b.i2c.scl) : H(b.i2c.sda), what:`${b.i2c.bus} 的 ${n}` };
    case 'la_uart': return { key: n === 'TX' ? b.vcp.tx : b.vcp.rx, what:`${b.vcp.periph} 的 ${n}` };
    case 'la_spi':
      if (!sp) return null;
      if (n === 'CS'){ const cs = bench.modules.filter(x => SPI_TYPES.includes(x.type)).flatMap(x => netInfo(`${x.id}.CS`).gpio); return { keys:cs, what:'某個 SPI 元件的 CS' }; }
      return { key:{ SCK:sp.sck, MOSI:sp.mosi, MISO:sp.miso }[n], what:`${b.spi.bus} 的 ${n}` };
    case 'la_can': return { key:'CAN.BUS', xform:n.slice(-1), what:`CAN 收發器的 ${n}` };
  }
  return null;
}
export function probeOk(m, n){
  const s = probeSource(m, n), e = expectedSource(m, n);
  if (!e || s.kind !== 'line') return false;
  if (e.keys) return e.keys.includes(s.key);
  return s.key === e.key && (!e.xform || s.xform === e.xform);
}

/** 沒有共地時，探棒量到的電位會飄動：在真正的訊號上疊加隨機的短脈衝 */
function noisy(sig, t0, t1, seed){
  let x = seed || 1; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF);
  const g = []; for (let t = t0 + rnd() * 80; t < t1; t += 20 + rnd() * 160){ g.push(t, t + .3 + rnd() * 2.5); }
  const times = [...new Set([...sig.t, ...g])].sort((a, b) => a - b), out = { init:sig.init, t:[], v:[] };
  let gi = 0, si = 0, gl = 0, sl = sig.init, cur = sig.init;
  for (const t of times){
    while (si < sig.t.length && sig.t[si] <= t){ sl = sig.v[si]; si++; }
    while (gi < g.length && g[gi] <= t){ gl ^= 1; gi++; }
    const v = sl ^ gl; if (v !== cur){ out.t.push(t); out.v.push(v); cur = v; }
  }
  return out;
}

/** 擷取 [t0, t1] 的訊號（微秒） */
export function capture(m, t0, t1){
  const T = MODULE_TYPES[m.type], proto = T.analyzer, gndOk = netInfo(`${m.id}.GND`).gnd;
  const chans = T.pins.filter(([n]) => n !== 'GND').map(([n], i) => {
    const src = probeSource(m, n), idle = IDLE[proto][n] ?? 1;
    let sig = src.kind === 'line' ? snapshot(src.key, t0, t1, idle) : src.kind === 'const' ? constSig(src.v) : null;
    if (sig && !gndOk && src.kind === 'line') sig = noisy(sig, t0, t1, 7 + i * 13);
    return { name:n, src, sig, ok:probeOk(m, n), analog: proto === 'can' ? (src.xform || null) : null };
  });
  return { id:m.id, proto, t0, t1, gndOk, chans };
}

/** 依設定取樣與解碼。opt：{ rate, baud, cpol, cpha, bitrate } */
export function analyze(cap, opt){
  const S = c => c && c.sig ? sampleSig(c.sig, opt.rate, cap.t0) : null;
  const chans = cap.chans.map(c => ({ ...c, s:S(c) })), get = n => chans.find(c => c.name === n)?.s || null;
  let anns = [], stats = {};
  if (cap.proto === 'i2c' && get('SCL') && get('SDA')){ const r = decodeI2C(get('SCL'), get('SDA')); anns = r.anns; stats = r.stats; }
  if (cap.proto === 'uart'){
    for (const n of ['TX', 'RX']){ const s = get(n); if (!s) continue; const r = decodeUART(s, { baud:opt.baud }); anns.push(...r.anns.map(a => ({ ...a, row:`${n}.${a.row}`, ch:n }))); stats[n] = r.stats; }
  }
  if (cap.proto === 'spi' && get('SCK') && get('MOSI')){ const r = decodeSPI(get('SCK'), get('MOSI'), get('MISO'), get('CS'), opt); anns = r.anns; stats = r.stats; }
  if (cap.proto === 'can'){
    const h = chans.find(c => c.name === 'CANH'), l = chans.find(c => c.name === 'CANL');
    // 差動：CANH − CANL > 0.9 V 為顯性（0）。探棒接反時差動電壓是負的，解碼出來的位元會全部顛倒
    const pick = h?.s && h.src.xform ? h : l?.s && l.src.xform ? l : null;
    if (pick){
      const inv = (pick.name === 'CANH') !== (pick.src.xform === 'H');
      const logic = inv ? { init:1 - pick.s.init, t:pick.s.t, v:pick.s.v.map(v => 1 - v) } : pick.s;
      const r = decodeCAN(logic, { bitrate:opt.bitrate }); anns = r.anns; stats = { ...r.stats, inverted:inv };
    }
  }
  return { chans, anns, stats, issues:diagnose(cap, chans, anns, stats, opt) };
}

/* ---------- 為什麼會這樣：依擷取結果找出可能的原因 ---------- */
const fmtRate = r => r >= 1e6 ? `${+(r / 1e6).toFixed(2)} MS/s` : `${+(r / 1e3).toFixed(1)} kS/s`;
export function diagnose(cap, chans, anns, stats, opt){
  const out = [], add = (sev, title, body) => out.push({ sev, title, body });
  const m = moduleById(cap.id); if (!m) return out;
  if (!cap.gndOk) add('err', '分析儀沒有和開發板共地', '邏輯分析儀量的是「探棒和分析儀 GND 之間的電壓」。GND 沒接時，兩邊的地電位不同，量到的波形會出現很多亂跳的雜訊，解碼也會失敗。把分析儀的 GND 接到開發板的 GND 或電源軌 −。');
  for (const c of chans){
    if (c.src.kind === 'open') add('info', `${c.name} 探棒沒有接`, `這個通道沒有訊號。${expectedSource(m, c.name) ? `應該接到 ${expectedSource(m, c.name).what}。` : ''}`);
    else if (c.src.kind === 'const') add('warn', `${c.name} 探棒接到 ${c.src.label}`, '電源或地的電位是固定的，所以這個通道只會是一條直線。探棒要接在訊號線上。');
    else if (c.src.kind === 'float') add('warn', `${c.name} 探棒沒有連到開發板`, '這條線只接到模組，MCU 沒有在上面送訊號。');
    else if (!c.ok && expectedSource(m, c.name)){
      const e = expectedSource(m, c.name), other = chans.find(o => o !== c && o.src.key === (e.keys ? null : e.key) && (!e.xform || o.src.xform === e.xform));
      add('warn', other ? `${c.name} 和 ${other.name} 探棒可能接反了` : `${c.name} 探棒接到 ${c.src.label}`, other ? `${c.name} 量到的其實是 ${other.name} 的訊號。對調兩根探棒，或在接線分頁改接。` : `${c.name} 應該接到 ${e.what}。接錯線時，解碼器會把別的訊號當成 ${c.name}，結果會是亂碼或什麼都解不出來。`);
    }
  }
  const edges = chans.reduce((n, c) => n + (c.s ? c.s.t.length : 0), 0);
  if (!edges && chans.some(c => c.src.kind === 'line')) add('info', '這段時間沒有任何訊號變化', '線一直維持同一個電位。可能的原因：程式還沒燒錄或沒有在執行、這段時間程式剛好沒有使用這個匯流排，或是探棒接在沒有用到的線上。按「擷取」再試一次，或延長擷取時間。');
  // 取樣率是否足夠：最短脈衝至少要取到 4 個點
  const mp = Math.min(...chans.filter(c => c.sig && c.src.kind === 'line').map(c => minPulse(c.sig)));
  if (Number.isFinite(mp) && mp > 0 && opt.rate * mp / 1e6 < 4) add('warn', `取樣率 ${fmtRate(opt.rate)} 可能不夠`, `訊號裡最短的脈衝約 ${mp.toFixed(2)} µs，用 ${fmtRate(opt.rate)} 取樣只能取到 ${(opt.rate * mp / 1e6).toFixed(1)} 個點。一般建議取樣率至少是訊號最快變化的 4 倍以上，否則邊緣的位置誤差太大，短的脈衝甚至會整個消失，解碼就會出錯。把取樣率調高試試看。`);
  const cnt = k => anns.filter(a => a.kind === k).length;
  switch (cap.proto){
    case 'i2c':
      if (stats.nacks) add('warn', `有 ${stats.nacks} 次位址沒有回應（NACK）`, '主機送出位址後，第 9 個時脈 SDA 仍然是高電位，表示匯流排上沒有元件認得這個位址。常見原因：感測器沒有接電源或 GND、SDA／SCL 沒接好、位址寫錯（例如把 8 位元位址當成 7 位元），或感測器還在轉換中（例如 HDC1080）。');
      if (cnt('packet') && !stats.nacks && cap.gndOk) add('ok', `解出 ${cnt('packet')} 筆 I2C 傳輸`, `SCL 時脈約 ${(stats.sclHz / 1000).toFixed(0)} kHz。點波形上的任何一段，看它代表什麼意思。`);
      if (edges && !cnt('packet')) add('warn', '有訊號，但解不出 I2C 傳輸', '找不到「起始條件」（SCL 高電位時 SDA 由高變低）。可能是 SCL／SDA 探棒接反、取樣率太低，或是沒有共地。');
      break;
    case 'uart': {
      for (const n of ['TX', 'RX']){
        const st = stats[n]; if (!st) continue;
        if (st.errors) add('warn', `${n}：有 ${st.errors} 個位元組框架錯誤`, `解碼器在停止位元的位置讀到低電位。最常見的原因是鮑率設錯${st.stdBaud && st.stdBaud !== opt.baud ? `：最短脈衝約 ${(1e6 / st.estBaud).toFixed(2)} µs，換算約 ${st.stdBaud} bps，但解碼設定是 ${opt.baud} bps` : ''}。UART 沒有時脈線，雙方一定要事先約定相同的鮑率。`);
        else if (st.bytes && st.stdBaud && st.stdBaud !== opt.baud) add('warn', `${n}：鮑率可能不對`, `量到的最短脈衝約 ${(1e6 / st.estBaud).toFixed(2)} µs，換算約 ${st.stdBaud} bps，但解碼設定是 ${opt.baud} bps。解出來的字可能是亂碼。`);
        else if (st.bytes) add('ok', `${n}：解出 ${st.bytes} 個位元組`, `每個位元約 ${(1e6 / opt.baud).toFixed(2)} µs（${opt.baud} bps）。點任一個位元組看它的二進位與 ASCII。`);
      }
      break;
    }
    case 'spi': {
      const fr = anns.filter(a => a.kind === 'sframe');
      if (fr.length) add('ok', `解出 ${fr.length} 次 SPI 傳輸`, `SCK 約 ${(stats.sckHz / 1e6).toFixed(2)} MHz。每次 CS 拉低到拉高是一筆傳輸；點 MOSI／MISO 的位元組看主機送了什麼、從機回了什麼。`);
      if (fr.length && fr.every(a => a.d.miso.every(x => x === 0xFF))) add('warn', 'MISO 一直是 0xFF', '從機沒有在 MISO 上回應（線被拉高）。常見原因：CS 沒有拉低、從機沒有供電、MISO 沒接，或是 CS 接到了別的元件。');
      const cs = chans.find(c => c.name === 'CS'), sck = chans.find(c => c.name === 'SCK');
      if (!fr.length && cs?.s && sck?.s?.t.length) add('info', 'SCK 有時脈，但 CS 探棒接的元件沒有被選中', `這段時間 MCU 在和別的 SPI 元件通訊（它們共用 SCK／MOSI／MISO），而 CS 探棒接的那一個（${cs.src.label}）一直是高電位，所以解碼器不理會這些時脈。把 CS 探棒改接到正在通訊的元件，或延長擷取時間再試一次。`);
      if (!chans.find(c => c.name === 'CS')?.s) add('info', 'CS 探棒沒有接', '沒有 CS 時，解碼器不知道每筆傳輸從哪裡開始，只能從第一個時脈開始每 8 個位元算一個位元組。');
      if (opt.cpol || opt.cpha) add('info', `目前用模式 ${opt.cpol * 2 + opt.cpha} 解碼`, '範例程式用的是模式 0（CPOL=0、CPHA=0：閒置低電位、上升緣取樣）。模式設錯時，解碼器會在資料正在改變的時候取樣，位元會錯一位。');
      break;
    }
    case 'can': {
      const frames = anns.filter(a => a.row === 'packets');
      if (stats.inverted) add('warn', 'CANH 與 CANL 探棒接反了', '差動電壓（CANH − CANL）變成負的，解碼器把顯性和隱性位元看反了，所以解不出正確的訊框。');
      if (cnt('cframenack')) add('warn', `有 ${cnt('cframenack')} 個訊框沒有收到 ACK`, '傳送的節點在 ACK 槽送出隱性位元，等其他節點把它拉成顯性。沒有人拉低就表示匯流排上沒有正常接收的節點：例如對端節點關閉、MCU 的 CAN 還沒啟動，或 TXD／RXD 接錯。傳送端會送出錯誤旗標，並且自動重送。');
      if (cnt('ccrcerr')) add('warn', 'CRC 錯誤', '收到的 CRC 和自己算的不一樣，代表傳輸途中有位元出錯（或是鮑率、取樣率設錯）。');
      if (frames.length && !cnt('cframenack') && !cnt('ccrcerr')) add('ok', `解出 ${frames.length} 個 CAN 訊框`, `約 ${Math.round(opt.bitrate / 1000)} kbps，每個位元 ${(1e6 / opt.bitrate).toFixed(1)} µs。紫色的是填充位元（連續 5 個相同位元後硬塞進去的相反位元）。`);
      if (edges && !frames.length && !stats.inverted) add('warn', '有訊號，但解不出 CAN 訊框', `可能是解碼鮑率設錯（量到的最短脈衝約 ${stats.estRate ? (1e6 / stats.estRate).toFixed(2) : '?'} µs，約 ${stats.estRate ? Math.round(stats.estRate / 1000) : '?'} kbps），或是取樣率太低。`);
      break;
    }
  }
  return out;
}

/** 3D 分析儀上的指示燈：最近 0.25 秒內探棒上有訊號變化 */
export function analyzerActive(m){
  const t = tNow() - 250e3;
  return MODULE_TYPES[m.type].pins.some(([n]) => { const s = probeSource(m, n); return s.kind === 'line' && lastActivity(s.key) > t; });
}
export { hex2, STD_BAUD, variantOf };
