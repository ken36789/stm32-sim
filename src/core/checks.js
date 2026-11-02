// 接線檢測規則：每條結果為 { sev:'err'|'warn'|'ok'|'info', title, detail, pins, action? }
import { MODULE_TYPES, variantOf } from './parts.js';
import { bench, wires, NET, SIM, net, netInfo, shorts, nodeOf, isGpioName, moduleLabel, headerPin, PINS, isAnalyzer, moduleById } from './sim.js';
import { SPI_PINS } from './buses.js';
import { probeSource, expectedSource, probeOk } from './analyzer.js';
import { stripCode } from './compiler.js';
import { hooks } from './hooks.js';

/** 找出程式實際輸出、讀取的 GPIO（支援 STM32 HAL、MSPM0、MSP430、TivaWare、C2000、MCUXpresso 的寫法） */
export function analyzeCode(src){
  const code = stripCode(src, false), b = bench.board, outs = new Set(), ins = new Set(), macros = {};
  for (const d of code.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+([^\n]+?)[ \t]*$/gm)) macros[d[1]] = d[2];
  const expand = s => { let t = s; for (let k = 0; k < 3; k++) t = t.replace(/\b[A-Za-z_]\w*\b/g, w => macros[w] ?? w); return t; };
  const num = s => (String(s).match(/(\d+)\s*[uUlL]*\s*\)*\s*$/) || [])[1];
  const each = (re, fn) => {
    for (const m of code.matchAll(re)){
      let i = m.index + m[0].length, depth = 1, j = i;
      for (; j < code.length && depth; j++){ if (code[j] === '(') depth++; else if (code[j] === ')') depth--; }
      const args = [], body = code.slice(i, j - 1); let cur = '', dp = 0;
      for (const ch of body){ if (ch === ',' && !dp){ args.push(cur); cur = ''; continue; } if (ch === '(') dp++; if (ch === ')') dp--; cur += ch; }
      args.push(cur); fn(m[1], args.map(a => expand(a.trim())));
    }
  };
  const masks = s => [...s.matchAll(/(?:DL_GPIO_PIN_|GPIO_PIN_|GPIO_PIN)(\d+)/g)].map(m => m[1]);
  const nxp = (base, a, c) => {
    if (/^\(?GPIO\)?$/.test(base)) return `PIO${num(a)}_${num(c)}`;
    const k = base.match(/GPIO([A-E])\b/); if (k) return `PT${k[1]}${num(a)}`;
    const g = base.match(/GPIO(\d+)/); if (!g) return null;
    return b.pinStyle === 'imxrt' ? `GPIO${g[1]}_IO${String(num(a)).padStart(2, '0')}` : `P${g[1]}_${num(a)}`;
  };
  const add = (set, p) => { if (p && !/undefined|null/.test(p)) set.add(p); };
  each(/\b(HAL_GPIO_(?:WritePin|TogglePin|ReadPin)|DL_GPIO_(?:setPins|clearPins|togglePins|readPins)|GPIOPin(?:Write|Read))\s*\(/g, (f, a) => {
    const port = (a[0].match(/GPIO_?PORT([A-Q])_BASE|GPIO([A-K])\b/) || []).slice(1).find(Boolean); if (!port) return;
    masks(a[1] || '').forEach(n => add(/Read/i.test(f) ? ins : outs, `P${port}${n}`));
  });
  each(/\b(GPIO_(?:setOutputHighOnPin|setOutputLowOnPin|toggleOutputOnPin|getInputPinValue))\s*\(/g, (f, a) => {
    const port = (a[0].match(/GPIO_PORT_P(\w+)/) || [])[1]; if (!port) return;
    masks(a[1] || '').forEach(n => add(f.includes('Input') ? ins : outs, `P${port}.${n}`));
  });
  each(/\b(GPIO_(?:writePin|togglePin|readPin))\s*\(/g, (f, a) => add(f.includes('read') ? ins : outs, `GPIO${num(a[0])}`));
  each(/\b(GPIO_(?:PinWrite|PinRead|PortToggle|PortSet|PortClear))\s*\(/g, (f, a) => {
    const lpc = /^\(?GPIO\)?$/.test(a[0]), set = f === 'GPIO_PinRead' ? ins : outs;
    if (f === 'GPIO_PinWrite' || f === 'GPIO_PinRead') add(set, lpc ? nxp(a[0], a[1], a[2]) : nxp(a[0], a[1]));
    else { const sh = (lpc ? a[2] : a[1] || '').match(/<<\s*\(?\s*(\d+)/); if (sh) add(set, lpc ? nxp(a[0], a[1], sh[1]) : nxp(a[0], sh[1])); }
  });
  return { outs, ins,
    i2c:/HAL_I2C_|DL_I2C_|_I2C_master|I2CMaster|I2C_sendStartCondition|I2C_MasterStart|LPI2C_Master/.test(code),
    adc:/HAL_ADC_GetValue|DL_ADC12_getMemResult|ADC\w*_getResults|ADCSequenceDataGet|ADC_readResult|ADC16_GetChannelConversionValue|LPADC_GetConvResult|ADC_GetChannelConversion/.test(code),
    spi:/HAL_SPI_|DL_SPI_\w*transmit|_SPI_transmitData|SSIDataPut|SPI_writeData|SPI_MasterTransferBlocking|DSPI_MasterTransfer|LPSPI_MasterTransfer/.test(code),
    can:/HAL_CAN_AddTxMessage|HAL_FDCAN_AddMessage|DL_MCAN_TXBufAddReq|CANMessageSet|CAN_sendMessage|FLEXCAN_TransferSend|FLEXCAN_WriteTxMb/.test(code),
    step:/HAL_TIM_PWM_Start|DL_Timer[GA]_startCounter|Timer_[AB]_outputPWM|PWMGenEnable|EPWM_setTimeBaseCounterMode|FTM_StartTimer|TPM_StartTimer|CTIMER_StartTimer|QTMR_StartTimer/.test(code) };
}

const railV = node => { const i = netInfo(node); return i.v5 ? 5 : i.v33 ? 3.3 : 0; };
const list = s => [...s].join('、') || '（沒有）';
const pinName = mcu => { const h = bench.board.header.find(x => x.mcu === mcu); return h && h.label !== mcu ? `${h.label}（${mcu}）` : mcu; };
const callHint = (p, dir) => ({ out:'用 GPIO 輸出函式控制它', in:'用 GPIO 讀取函式讀它' })[dir] + `（${p}）`;

export function runChecks(src){
  const out = [], add = (sev, title, detail, pins = [], action) => out.push({ sev, title, detail, pins, action });
  const b = bench.board, code = analyzeCode(src);
  const wired = new Set(); wires.forEach(w => { wired.add(w.a); wired.add(w.b); });
  const netPins = node => { const ms = new Set(net(node)); return [...wired].filter(id => ms.has(nodeOf(id))); };
  const hasWire = id => wired.has(id);
  const pinsOr = id => hasWire(id) ? netPins(id) : [id];
  if (!wires.length){ add('info', '還沒有接任何線', '在 3D 畫面依序點兩個金色腳位，或到「接線」分頁按「建議接線」。'); return out; }

  for (const s of shorts()){
    const pins = [...wired].filter(id => s.ms.includes(nodeOf(id)));
    if (s.type === 'gnd') add('err', `短路：${s.ms.includes('5V') ? '5V' : '3V3'} 直接接到 GND`, '電源與地之間沒有任何負載。通電後 USB 過電流保護會切斷電源，整塊板子停止運作。', pins);
    else add('err', '電源互接：3V3 與 5V 接在一起', '兩組不同電壓的電源直接相連，穩壓器會互相灌電流。', pins);
  }
  for (const ms of Object.values(NET.groups)){
    const gp = ms.filter(isGpioName); if (!gp.length) continue;
    const s = new Set(ms), rail = s.has('GND') ? 'GND' : s.has('3V3') ? '3V3' : s.has('5V') ? '5V' : null;
    if (rail && !ms.some(x => /^M\d+\./.test(x))) add('warn', `${gp.map(pinName).join('、')} 直接接到 ${rail}`, `程式若把這支腳設成輸出${rail === 'GND' ? '高' : '低'}電位，就會變成短路。中間應該經過模組或限流電阻。`, netPins(gp[0]));
    if (gp.length > 1) add('warn', `${gp.map(pinName).join(' 與 ')} 接在一起`, '兩支 GPIO 同時當輸出且電位不同時會互相拉扯，可能損壞腳位。', netPins(gp[0]));
  }
  if ([...wired].some(id => PINS[id]?.group === 'rail')){
    if (!railV('RAIL+')) add('warn', '電源軌 + 沒有接電源', '從排針的 3V3（或 5V）拉一條線到電源軌的 + 孔，模組才有電。', netPins('RAIL+'));
    if (!netInfo('RAIL-').gnd) add('warn', '電源軌 − 沒有接地', '從排針的 GND 拉一條線到電源軌的 − 孔。', netPins('RAIL-'));
  }

  for (const m of bench.modules){
    const v = variantOf(m.type, m.variant), T = MODULE_TYPES[m.type], name = `${moduleLabel(m)}（${v.name}）`, P = n => `${m.id}.${n}`;
    if (!T.pins.some(([n]) => hasWire(P(n)))){ add('info', `${name} 沒有使用`, '沒有接線，略過檢查。'); continue; }
    const gnd = (n = 'GND') => {
      if (netInfo(P(n)).gnd) add('ok', `${moduleLabel(m)} ${n} → GND`, '接地正確。', netPins(P(n)));
      else add('err', `${moduleLabel(m)} 的 ${n} 沒有接地`, '沒有接地就沒有電流回路。接到排針的 GND 或電源軌 −。', pinsOr(P(n)));
    };
    const vcc = (min, max, why) => {
      const s = railV(P('VCC'));
      if (!s) add('err', `${moduleLabel(m)} 的 VCC 沒有電源`, `接到 ${min > 3.6 ? '5V' : '3V3'}（排針或電源軌 +）。`, pinsOr(P('VCC')));
      else if (s > max) add('err', `${name} 的 VCC 接到 ${s} V`, why || `這個元件最高 ${max} V，會燒毀。改接 3V3。`, netPins(P('VCC')));
      else if (s < min) add('err', `${name} 的 VCC 只有 ${s} V`, why || `這個元件至少需要 ${min} V，改接 5V。`, netPins(P('VCC')));
      else add('ok', `${moduleLabel(m)} VCC → ${s === 5 ? '5V' : '3V3'}`, '電壓在工作範圍內。', netPins(P('VCC')));
    };
    const gpio = (n, dir) => {
      const i = netInfo(P(n)), label = `${moduleLabel(m)} ${n}`;
      if (!hasWire(P(n))){ add('err', `${label} 沒有接`, dir === 'adc' ? '接到開發板的類比輸入腳（例如 A0）。' : '接到開發板的一支 GPIO。', [P(n)]); return null; }
      if (i.gnd || i.v33 || i.v5){ add('err', `${label} 接到電源或地`, dir === 'out' ? '訊號腳接到電源，程式無法控制。改接 GPIO。' : '訊號腳應該接到 GPIO。', netPins(P(n))); return null; }
      if (!i.gpio.length){ add('err', `${label} 沒有接到開發板`, '只接到其他模組，沒有 GPIO 能控制或讀取它。', netPins(P(n))); return null; }
      const p = i.gpio[0], h = bench.board.header.find(x => x.mcu === p);
      if (dir === 'adc' && !(h && h.tags.includes('adc'))){ add('err', `${label} 接到 ${pinName(p)}`, '這支腳沒有 ADC 功能，讀不到類比電壓。改接 A0–A5 等類比輸入腳。', netPins(P(n))); return null; }
      add('ok', `${label} → ${pinName(p)}`, dir === 'out' ? `由 ${p} 控制。` : dir === 'in' ? `用 HAL_GPIO_ReadPin 讀 ${p}。` : `${p} 具備 ADC 功能。`, netPins(P(n)));
      if (dir === 'out' && !code.outs.has(p)) add('warn', `程式沒有控制 ${p}`, `程式輸出的腳位是 ${list(code.outs)}。${callHint(p, 'out')}，或按「程式」分頁的「載入範例程式」。`, netPins(P(n)));
      if (dir === 'in' && !code.ins.has(p)) add('warn', `程式沒有讀取 ${p}`, `程式讀取的腳位是 ${list(code.ins)}。${callHint(p, 'in')}，或按「載入範例程式」。`, netPins(P(n)));
      if (dir === 'adc' && !code.adc) add('warn', '程式沒有讀取 ADC', '程式裡沒有呼叫 ADC 讀值函式。按「載入範例程式」可以看到這塊板子 SDK 的 ADC 讀法。', netPins(P(n)));
      return p;
    };
    switch (m.type){
      case 'led': gpio('SIG', 'out'); gnd(); break;
      case 'rgb': gpio('R', 'out'); gpio('G', 'out'); gpio('B', 'out'); gnd(); break;
      case 'buzzer': gpio('SIG', 'out'); gnd(); if (v.id === 'buz-12') add('info', `${moduleLabel(m)} 用 3.3 V 驅動`, 'TMB12A05 在 3.3 V 下仍會響，但音量較小。換成 TMB12A03 會更大聲。'); break;
      case 'button':
        if (railV(P('VCC')) === 5) add('warn', `${moduleLabel(m)} 的 VCC 接到 5V`, '按下時會把 5 V 送進 GPIO，部分腳位不耐 5 V。建議改接 3V3。', netPins(P('VCC')));
        else vcc(2, 3.6);
        gpio('OUT', 'in'); gnd(); break;
      case 'pir': vcc(v.vmin, 20, v.vmin > 3.6 ? 'HC-SR501 需要 4.5 V 以上，接 3V3 不會正常偵測。改接 5V，輸出仍是 3.3 V 不會傷到 MCU。' : null); gpio('OUT', 'in'); gnd(); break;
      case 'relay': vcc(v.vmin, 5.5, v.vmin > 3.6 ? '5 V 繼電器的線圈接 3.3 V 吸不動。改接 5V，或換成 3 V 繼電器模組。' : null); gpio('IN', 'out'); gnd(); break;
      case 'pot': vcc(1.8, 3.6, '電位器接 5 V 時輸出最高 5 V，超過 ADC 的 3.3 V 上限，會損壞輸入腳。改接 3V3。'); gpio('OUT', 'adc'); gnd(); break;
      case 'tc': case 'flash': {
        if (!b.spi){ add('err', `${b.name} 沒有可用的 SPI`, b.noSpi || '這塊板子沒有可以用的 SPI。換一塊開發板再試。', pinsOr(P('CS'))); break; }
        vcc(v.vmin, v.vmax, `${v.part} 的工作電壓是 ${v.vmin}–${v.vmax} V。`); gnd();
        const N = SPI_PINS[m.type], want = { sck:headerPin(b.spi.sck), miso:headerPin(b.spi.miso), mosi:headerPin(b.spi.mosi) };
        const roles = [['sck', N.sck, 'SCK'], ['miso', N.miso, 'MISO'], ...(N.mosi ? [['mosi', N.mosi, 'MOSI']] : [])];
        const swapped = N.mosi && netInfo(P(N.mosi)).gpio.includes(want.miso.mcu) && netInfo(P(N.miso)).gpio.includes(want.mosi.mcu);
        if (swapped) add('err', `${moduleLabel(m)} 的 ${N.mosi} 與 ${N.miso} 接反`, `${N.mosi}（資料輸入）要接 MCU 的 MOSI＝${pinName(want.mosi.mcu)}，${N.miso}（資料輸出）要接 MISO＝${pinName(want.miso.mcu)}。名稱是從元件的角度看的：元件的輸入接主機的輸出。`, [...netPins(P(N.mosi)), ...netPins(P(N.miso))]);
        else for (const [r, n, role] of roles){
          const i = netInfo(P(n));
          if (i.gpio.includes(want[r].mcu)) add('ok', `${moduleLabel(m)} ${n} → ${pinName(want[r].mcu)}`, `${want[r].mcu} 是 ${b.spi.bus}_${role}。`, netPins(P(n)));
          else if (i.gpio.length) add('err', `${moduleLabel(m)} 的 ${n} 接到 ${pinName(i.gpio[0])}`, `這支腳不是 ${b.spi.bus} 的 ${role}，要接 ${pinName(want[r].mcu)}。`, netPins(P(n)));
          else add('err', `${moduleLabel(m)} 的 ${n} 沒有接到開發板`, `${n} 要接到 ${pinName(want[r].mcu)}（${b.spi.bus}_${role}）。`, pinsOr(P(n)));
        }
        const cs = gpio('CS', 'out');
        if (cs && [b.spi.sck, b.spi.miso, b.spi.mosi].map(l => headerPin(l)?.mcu).includes(cs)) add('err', `${moduleLabel(m)} 的 CS 接到 SPI 訊號腳`, 'CS 要接一支獨立的 GPIO，不能和 SCK／MISO／MOSI 共用。');
        if (!code.spi) add('warn', '程式沒有使用 SPI', `元件已接好，但程式沒有呼叫 SPI 傳輸函式。可以按「載入範例程式」取得 ${v.part} 的讀取範例。`);
        break;
      }
      case 'can': {
        if (!b.can){ add('err', `${b.mcu} 不能做 CAN 實驗`, b.noCan || '這顆晶片沒有 CAN 控制器。', pinsOr(P('TXD'))); break; }
        vcc(v.vmin, v.vmax, v.vmin > 3.6 ? 'TJA1050 需要 5 V 供電，接 3V3 不會動作。改接 5V，或換成 3.3 V 的 SN65HVD230。' : `${v.part} 是 3.3 V 的收發器，接 5 V 會損壞。改接 3V3。`); gnd();
        const tx = headerPin(b.can.tx), rx = headerPin(b.can.rx), ti = netInfo(P('TXD')), ri = netInfo(P('RXD'));
        if (ti.gpio.includes(rx.mcu) && ri.gpio.includes(tx.mcu)) add('err', `${moduleLabel(m)} 的 TXD 與 RXD 接反`, `收發器的 TXD 要接 MCU 的 CAN_TX＝${pinName(tx.mcu)}（MCU 送出 → 收發器轉成差動訊號），RXD 接 CAN_RX＝${pinName(rx.mcu)}。`, [...netPins(P('TXD')), ...netPins(P('RXD'))]);
        else for (const [n, want, i, role] of [['TXD', tx, ti, 'TX'], ['RXD', rx, ri, 'RX']]){
          if (i.gpio.includes(want.mcu)) add('ok', `${moduleLabel(m)} ${n} → ${pinName(want.mcu)}`, `${want.mcu} 是 ${b.can.bus}_${role}。`, netPins(P(n)));
          else if (i.gpio.length) add('err', `${moduleLabel(m)} 的 ${n} 接到 ${pinName(i.gpio[0])}`, `這支腳不是 ${b.can.bus} 的 ${role}，要接 ${pinName(want.mcu)}。`, netPins(P(n)));
          else add('err', `${moduleLabel(m)} 的 ${n} 沒有接到開發板`, `${n} 要接到 ${pinName(want.mcu)}（${b.can.bus}_${role}）。`, pinsOr(P(n)));
        }
        for (const n of ['CANH', 'CANL']){ const i = netInfo(P(n)); if (i.gpio.length || i.v33 || i.v5 || i.gnd) add('err', `${moduleLabel(m)} 的 ${n} 接到開發板或電源`, 'CANH／CANL 是差動匯流排，只能接其他 CAN 節點或 CAN 分析儀，不能接 MCU 腳位或電源。', netPins(P(n))); }
        if (!code.can) add('warn', '程式沒有使用 CAN', '收發器已接好，但程式沒有送出 CAN 訊框。按「載入範例程式」可以看到這顆晶片 SDK 的 CAN 寫法。');
        add('info', `${moduleLabel(m)}：模組內建 120 Ω 終端電阻與測試節點`, '測試節點每 500 ms 送出 ID 0x200，也會對 MCU 送出的訊框回 ACK。把 CAN 分析儀接到 CANH／CANL 就能看到匯流排上的差動訊號。');
        break;
      }
      case 'stepper': {
        vcc(2, 5.5, 'IOREF 是邏輯電位參考，要接 3V3（和 MCU 相同的電位）。'); gnd();
        if (!b.step){ add('err', `${b.name} 沒有設定 STEP 輸出`, b.noStep || '這塊板子沒有可以用的計時器 PWM 輸出。', pinsOr(P('CLK'))); }
        else {
          const ci = netInfo(P('CLK')), stepAt = ci.gpio.map(g => b.step.findIndex(x => headerPin(x.pin)?.mcu === g)).find(k => k >= 0);
          const list = b.step.map(x => `${pinName(headerPin(x.pin).mcu)}（${x.tim}）`).join(' 或 ');
          if (!hasWire(P('CLK'))) add('err', `${moduleLabel(m)} 的 CLK 沒有接`, `CLK（STEP）要接到計時器的 PWM 輸出：${list}。`, [P('CLK')]);
          else if (stepAt === undefined) add('err', `${moduleLabel(m)} 的 CLK 接到 ${ci.gpio.length ? pinName(ci.gpio[0]) : '非 MCU 腳位'}`, `STEP 脈波很快（每秒上萬個），要由計時器的硬體 PWM 產生，不能用一般 GPIO 慢慢切換。本板的 STEP 輸出在 ${list}。`, netPins(P('CLK')));
          else {
            const x = b.step[stepAt], others = bench.modules.filter(o => o !== m && o.type === 'stepper' && netInfo(`${o.id}.CLK`).gpio.includes(headerPin(x.pin).mcu));
            add('ok', `${moduleLabel(m)} CLK → ${pinName(headerPin(x.pin).mcu)}`, `${x.tim} 的 PWM 輸出，每個脈波前進一個微步。`, netPins(P('CLK')));
            if (others.length) add('warn', `${moduleLabel(m)} 和 ${others.map(moduleLabel).join('、')} 接在同一個 STEP 輸出`, '兩顆馬達會收到一模一樣的脈波，沒辦法分開控制速度。改接另一組 STEP 輸出。', netPins(P('CLK')));
            if (!code.step) add('warn', '程式沒有啟動計時器 PWM', 'STEP 腳接好了，但程式沒有開啟計時器的 PWM 輸出，馬達不會轉。按「載入範例程式」可以看到這顆晶片 SDK 的寫法。');
          }
        }
        gpio('CW', 'out'); gpio('EN', 'out');
        break;
      }
      case 'la_i2c': case 'la_uart': case 'la_spi': case 'la_can': {
        const label = moduleLabel(m);
        if (!netInfo(P('GND')).gnd) add('warn', `${label} 的 GND 沒有接`, '邏輯分析儀量的是「探棒和 GND 之間的電壓」，沒有共地時波形會亂跳、解碼會失敗。把 GND 接到排針的 GND 或電源軌 −。', pinsOr(P('GND')));
        else add('ok', `${label} GND → GND`, '和開發板共地。', netPins(P('GND')));
        for (const [n] of T.pins.filter(([n]) => n !== 'GND')){
          const src = probeSource(m, n), exp = expectedSource(m, n);
          if (src.kind === 'open'){ add('info', `${label} 的 ${n} 探棒沒有接`, exp ? `要量 ${n} 的話，接到 ${exp.what}。` : '這個通道不會有訊號。', [P(n)]); continue; }
          if (probeOk(m, n)) add('ok', `${label} ${n} 探棒 → ${src.label}`, '探棒只量電壓，不會影響電路。', netPins(P(n)));
          else add('warn', `${label} 的 ${n} 探棒接到 ${src.label}`, exp ? `${n} 探棒應該接到 ${exp.what}。打開分析儀可以看到接錯時波形會變成什麼樣子。` : '這條線上沒有這種訊號。', netPins(P(n)));
        }
        break;
      }
      case 'temp': {
        vcc(1.7, v.vmax, `${v.part} 最高 ${v.vmax} V，接 5 V 會燒毀。改接 3V3。`); gnd();
        const sclH = headerPin(b.i2c.scl), sdaH = headerPin(b.i2c.sda), c = netInfo(P('SCL')), d = netInfo(P('SDA'));
        const swapped = c.gpio.includes(sdaH.mcu) && d.gpio.includes(sclH.mcu);
        if (swapped) add('err', `${moduleLabel(m)} 的 SCL 與 SDA 接反`, `${b.i2c.bus} 的 SCL 在 ${pinName(sclH.mcu)}、SDA 在 ${pinName(sdaH.mcu)}。把兩條線對調。`, [...netPins(P('SCL')), ...netPins(P('SDA'))]);
        else for (const [n, want, i] of [['SCL', sclH, c], ['SDA', sdaH, d]]){
          if (i.gpio.includes(want.mcu)) add('ok', `${moduleLabel(m)} ${n} → ${pinName(want.mcu)}`, `${want.mcu} 是 ${b.i2c.bus}_${n}。`, netPins(P(n)));
          else if (i.gpio.length) add('err', `${moduleLabel(m)} 的 ${n} 接到 ${pinName(i.gpio[0])}`, `這支腳不是 I2C。本板的 ${b.i2c.bus} 在 ${pinName(sclH.mcu)}（SCL）和 ${pinName(sdaH.mcu)}（SDA）。`, netPins(P(n)));
          else add('err', `${moduleLabel(m)} 的 ${n} 沒有接到開發板`, `${n} 要接到 ${pinName(want.mcu)}。`, pinsOr(P(n)));
        }
        if (m.st.damaged) add('err', `${name} 已經損壞`, '先前通電時電壓過高。改好接線後換一顆新的。', [P('VCC')], { label:'更換新的感測器', fn:() => { m.st.damaged = false; m.st.dev = null; hooks.sensorDamaged(m, false); hooks.toast('已換上新的感測器。'); hooks.recheck(); } });
        if (!code.i2c) add('warn', '程式沒有使用 I2C', `感測器已接好，但程式沒有呼叫 I2C 函式讀取它。可以按「載入範例程式」取得 ${v.part} 的讀取範例。`);
        break;
      }
    }
  }

  // I2C 位址衝突
  const onBus = bench.modules.filter(m => m.type === 'temp' && netInfo(`${m.id}.SCL`).gpio.length && netInfo(`${m.id}.SDA`).gpio.length);
  const byAddr = {};
  onBus.forEach(m => { const a = variantOf(m.type, m.variant).addr; (byAddr[a] = byAddr[a] || []).push(m); });
  for (const [a, ms] of Object.entries(byAddr)) if (ms.length > 1)
    add('err', `I2C 位址衝突：0x${(+a).toString(16).toUpperCase()}`, `${ms.map(m => `${moduleLabel(m)}（${variantOf(m.type, m.variant).part}）`).join(' 和 ')} 使用相同位址，兩個都會回應，資料會錯亂。換掉其中一顆，或改用位址不同的型號。`, ms.map(m => `${m.id}.SDA`));

  const probeOnly = mcu => net(mcu).filter(x => /^M\d+\./.test(x)).every(x => isAnalyzer(moduleById(x.split('.')[0]) || {}));
  for (const h of b.header.filter(x => x.tags.includes('vcp')))
    if ([...wired].some(id => nodeOf(id) === h.mcu) && !probeOnly(h.mcu)) add('warn', `${pinName(h.mcu)} 是虛擬序列埠腳位`, `${h.mcu} 連到 ${b.vcp.periph}，printf 從這裡輸出。接外部裝置會干擾序列埠。`, netPins(h.mcu));
  for (const h of b.header.filter(x => x.tags.includes('led'))){
    const led = b.leds.find(l => l.pin === h.mcu);
    if ([...wired].some(id => nodeOf(id) === h.mcu)) add('info', `${pinName(h.mcu)} 同時連到板載 ${led.name}`, `這支腳在板上也接著 ${led.name}，輸出時板載 LED 會一起亮。`, netPins(h.mcu));
  }
  if (!SIM.usb) add('info', 'USB 沒有接上', '開發板沒有供電。接線檢測仍可進行，但程式無法燒錄與執行。');
  const rank = { err:0, warn:1, ok:2, info:3 };
  return out.sort((a, b2) => rank[a.sev] - rank[b2.sev]);
}
