// 接線檢測規則：每條結果為 { sev:'err'|'warn'|'ok'|'info', title, detail, pins, action? }
import { MODULE_TYPES, variantOf } from './parts.js';
import { bench, wires, NET, SIM, net, netInfo, shorts, nodeOf, isGpioName, moduleLabel, headerPin, PINS, isAnalyzer, moduleById } from './sim.js';
import { coilMap, drvStatus, drvOf, motorOfDriver, FAULTS, dmodeBits, ustepName } from './steppers.js';
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
const where = (i, pinName) => i.gpio.length ? pinName(i.gpio[0]) : i.v33 ? '3V3' : i.v5 ? '5V' : i.gnd ? 'GND' : i.src ? `${i.src} V 電源` : '其他模組';

/** TB67S128FTG 驅動板：每一支腳該怎麼接（依 Pololu #2998 與 Toshiba datasheet） */
function tb67Checks(m, v, c){
  const { add, hasWire, netPins, pinsOr, code, pinName } = c, P = n => `${m.id}.${n}`, L = moduleLabel(m), b = bench.board, st = drvStatus(m), ds = drvOf(m);
  const I = n => netInfo(P(n)), at = n => where(I(n), pinName);
  // ---- 馬達電源（右側）----
  const vinNet = net(P('VIN')), psuOnVin = vinNet.filter(x => /\.V\+$/.test(x)).map(x => moduleById(x.split('.')[0])).filter(x => x?.type === 'psu');
  const psuRev = vinNet.some(x => /\.V-$/.test(x));
  if (!hasWire(P('VIN'))) add('err', `${L} 的 VIN 沒有接馬達電源`, `VIN 要接馬達電源（DC 變壓器）的 V+，6.5–44 V。${bench.modules.some(x => x.type === 'psu') ? '' : '先到「元件」分頁新增「馬達電源」。'}`, [P('VIN')]);
  else if (psuRev) add('err', `${L} 的馬達電源接反了`, 'VIN 接到了變壓器的 V−。VIN 要接 V+、PGND 要接 V−（這塊驅動板有 40 V 以下的反接保護，所以只是不會動）。', netPins(P('VIN')));
  else if (I('VIN').v33 || I('VIN').v5) add('err', `${L} 的 VIN 接到 MCU 的 ${I('VIN').v5 ? '5V' : '3V3'}`, 'TB67S128FTG 的馬達電源至少要 6.5 V（低於約 6 V 會關閉輸出），而且開發板的 3V3／5V 只有幾百 mA，推不動馬達。改接馬達電源的 V+。', netPins(P('VIN')));
  else if (!psuOnVin.length) add('err', `${L} 的 VIN 沒有接到馬達電源`, 'VIN 要接馬達電源（DC 變壓器）的 V+。', netPins(P('VIN')));
  else {
    const ps = psuOnVin[0], pv = variantOf(ps.type, ps.variant).v;
    if (!net(P('PGND')).includes(`${ps.id}.V-`)) add('err', `${moduleLabel(ps)} 的 V− 沒有接到 ${L}`, '電流從 V+ 流進 VIN，要從 PGND 流回 V−。把 V− 接到驅動板右側的 PGND。', [...netPins(P('VIN')), ...pinsOr(P('PGND'))]);
    else if (pv < 6.5) add('err', `${L} 的 VIN 只有 ${pv} V`, `TB67S128FTG 至少要 6.5 V，低於約 6 V 時低電壓保護會關閉輸出，馬達不會動。把 ${moduleLabel(ps)} 換成 12 V 或 24 V 的變壓器。`, netPins(P('VIN')));
    else if (ps.st.on === false) add('warn', `${moduleLabel(ps)} 沒有打開`, '接線正確，但電源開關是關的。', netPins(P('VIN')));
    else add('ok', `${L} VIN → ${moduleLabel(ps)} V+（${pv} V）、PGND → V−`, `馬達電源 ${pv} V，在 6.5–44 V 範圍內。${pv < 20 ? '電壓越高，高速時的扭力越好（24 V 比 12 V 好）。' : ''}`, [...netPins(P('VIN')), ...netPins(P('PGND'))]);
  }
  // ---- 共地與邏輯電位（左側）----
  if (I('GND').gnd) add('ok', `${L} GND → MCU 的 GND`, '和 MCU 共地。左右兩側的 GND 在板上相通，所以馬達電源的 V− 也和 MCU 共地了。', netPins(P('GND')));
  else add('err', `${L} 沒有和 MCU 共地`, 'STEP、DIR、ENABLE 這些訊號的電壓是「相對於 MCU 的 GND」。驅動板的 GND 沒接到 MCU 的 GND 時，它看不到這些訊號，馬達不會動。把左側的 GND 接到排針的 GND 或電源軌 −。', pinsOr(P('GND')));
  const io = railV(P('IOREF'));
  if (!hasWire(P('IOREF'))) add('warn', `${L} 的 IOREF 沒有接`, 'IOREF 是邏輯電位參考，LO0／LO1 錯誤旗標會被上拉到這個電壓。沒接時 MCU 讀不到錯誤旗標。接到 3V3（和 MCU 一樣的電壓）。', [P('IOREF')]);
  else if (I('IOREF').src) add('err', `${L} 的 IOREF 接到 ${at('IOREF')}`, 'IOREF 要接 MCU 的邏輯電位（3V3），最高 5.5 V。', netPins(P('IOREF')));
  else if (io === 5 && (I('LO0').gpio.length || I('LO1').gpio.length)) add('warn', `${L} 的 IOREF 接到 5V`, 'LO0／LO1 會被上拉到 5 V，再送進 3.3 V 的 MCU 腳位。改接 3V3 比較安全。', netPins(P('IOREF')));
  else if (io) add('ok', `${L} IOREF → ${io === 5 ? '5V' : '3V3'}`, '邏輯電位參考，LO0／LO1 會被上拉到這個電壓。', netPins(P('IOREF')));
  else add('err', `${L} 的 IOREF 沒有電`, 'IOREF 要接到 3V3（排針或電源軌 +）。', netPins(P('IOREF')));
  // ---- 邏輯輸入 ----
  const outCheck = (n, p) => { if (!code.outs.has(p)) add('warn', `程式沒有控制 ${p}（${L} ${n}）`, `${n} 接到 ${pinName(p)}，但程式沒有輸出這支腳。按「載入範例程式」可以看到 STANDBY → ENABLE → 方向的設定順序。`, netPins(P(n))); };
  const input = (n, role) => {
    const i = I(n), wired = hasWire(P(n));
    if (i.src > 5.5){ add('err', `${L} 的 ${n} 接到 ${i.src} V 馬達電源`, '邏輯輸入最高 5.5 V，接到馬達電源會燒毀驅動 IC。', netPins(P(n))); return; }
    if (!wired) return role.open && role.open();
    if (i.gpio.length){ const p = i.gpio[0]; add('ok', `${L} ${n} → ${pinName(p)}`, role.gpio, netPins(P(n))); if (role.out !== false) outCheck(n, p); return; }
    if (i.gnd) return role.low();
    if (i.v33 || i.v5 || i.src) return role.high(i.v5 ? '5V' : i.v33 ? '3V3' : '驅動板 VCC');
    add('warn', `${L} 的 ${n} 只接到其他模組`, `${n} 沒有接到 MCU 或電源，等於沒接（板上下拉成低電位）。`, netPins(P(n)));
  };
  input('STBY', { gpio:'STANDBY 由程式控制：開機設成高電位；偵測到錯誤時拉低再拉高，就能清除鎖住的錯誤。',
    open:() => add('err', `${L} 的 STBY 沒有接`, 'STANDBY 板上下拉成低電位：驅動板一直在待機，馬達不會動。接到 MCU 的 GPIO（程式設成高電位），或接到 IOREF／3V3 讓它一直工作。', [P('STBY')]),
    low:() => add('err', `${L} 的 STBY 接到 GND`, '低電位＝待機，馬達永遠不會動。改接 MCU 的 GPIO 或 3V3。', netPins(P('STBY'))),
    high:w => add('ok', `${L} STBY → ${w}（一直工作）`, '固定高電位可以運作，但程式沒辦法用 STANDBY 清除鎖住的錯誤（只能關掉馬達電源再打開）。', netPins(P('STBY'))) });
  input('EN', { gpio:'ENABLE 由程式控制：高電位送電給馬達，低電位放開馬達（可以用手轉動、比較省電）。',
    open:() => add('err', `${L} 的 EN 沒有接`, 'ENABLE 板上下拉成低電位：線圈沒有電流，馬達不會出力。接到 MCU 的 GPIO（程式設成高電位）。', [P('EN')]),
    low:() => add('err', `${L} 的 EN 接到 GND`, '低電位＝輸出關閉，馬達不會出力。改接 MCU 的 GPIO。', netPins(P('EN'))),
    high:w => add('ok', `${L} EN → ${w}（一直送電）`, '馬達會一直保持轉矩（停著也會發熱）。接 GPIO 可以讓程式在不動時放開馬達。', netPins(P('EN'))) });
  input('RST', { gpio:'RESET 由程式控制：平常保持低電位；拉高時電氣角回到 45°，STEP 會被忽略。',
    open:() => add('ok', `${L} RST 沒接（板上下拉＝正常工作）`, 'RESET 平常要是低電位。不接線時板上的下拉電阻會讓它保持低電位。', [P('RST')]),
    low:() => add('ok', `${L} RST → GND`, 'RESET 固定低電位＝正常工作。', netPins(P('RST'))),
    high:w => add('err', `${L} 的 RST 接到 ${w}`, 'RESET 一直是高電位：電氣角被固定在 45°、STEP 全部被忽略，馬達不會轉。不接，或接 GND。', netPins(P('RST'))) });
  input('DIR', { gpio:'方向由程式控制：高電位順時針、低電位逆時針（實際轉向也和馬達線序有關）。',
    open:() => add('info', `${L} 的 DIR 沒有接`, 'CW/CCW 板上下拉成低電位：馬達只會往逆時針方向轉。要改方向就接到 MCU 的 GPIO。', [P('DIR')]),
    low:() => add('info', `${L} DIR → GND（固定逆時針）`, '方向固定。要用程式改方向就改接 GPIO。', netPins(P('DIR'))),
    high:w => add('info', `${L} DIR → ${w}（固定順時針）`, '方向固定。要用程式改方向就改接 GPIO。', netPins(P('DIR'))) });
  for (const n of ['MODE0', 'MODE1', 'MODE2']) input(n, { gpio:`${n} 由程式控制（微步設定的一個位元）。`, out:true, low:() => {}, high:() => {}, open:() => {} });
  add('info', `${L} 微步：MODE2..0 ＝ ${dmodeBits(st.div)} → ${ustepName(st.div)}`, st.modeWired ? 'MODE 腳有接線，由接線的電位決定（沒接的那幾支是低電位）。程式裡的 MICROSTEP 要和這個一樣，速度才算得對。' : 'MODE0–2 都沒接線，用驅動板上的跳線決定（可以在「元件」分頁或步進馬達示波器切換）。', ['MODE0', 'MODE1', 'MODE2'].map(P));
  // ---- CLK ----
  const ci = I('CLK');
  if (!hasWire(P('CLK'))) add('err', `${L} 的 CLK 沒有接`, `CLK（STEP）每個上升緣前進一個微步。${b.step ? `接到計時器的 PWM 輸出：${b.step.map(x => `${pinName(headerPin(x.pin).mcu)}（${x.tim}）`).join(' 或 ')}。` : '接到一支 GPIO。'}`, [P('CLK')]);
  else if (ci.src > 5.5) add('err', `${L} 的 CLK 接到 ${ci.src} V 馬達電源`, '邏輯輸入最高 5.5 V，會燒毀驅動 IC。', netPins(P('CLK')));
  else if (!ci.gpio.length) add('err', `${L} 的 CLK 沒有接到 MCU`, 'CLK 要接到 MCU，程式才能送出 STEP 脈波。', netPins(P('CLK')));
  else {
    const k = b.step ? ci.gpio.map(g => b.step.findIndex(x => headerPin(x.pin)?.mcu === g)).find(x => x >= 0) : undefined;
    if (k === undefined) add('warn', `${L} 的 CLK 接到一般 GPIO（${pinName(ci.gpio[0])}）`, `可以用程式切換（例如 HAL_GPIO_TogglePin ＋ 延遲）一步一步送，但最快只有幾百 pps。${b.step ? `要快就改接計時器的 PWM 輸出：${b.step.map(x => `${pinName(headerPin(x.pin).mcu)}（${x.tim}）`).join(' 或 ')}。` : '這塊板子沒有設定 STEP 用的計時器輸出。'}`, netPins(P('CLK')));
    else {
      const x = b.step[k], pin = headerPin(x.pin).mcu, others = bench.modules.filter(o => o !== m && (o.type === 'tb67' || o.type === 'stepper') && netInfo(`${o.id}.CLK`).gpio.includes(pin));
      add('ok', `${L} CLK → ${pinName(pin)}（${x.tim}）`, '計時器的硬體 PWM：頻率＝每秒幾步（pps），不佔用 CPU。', netPins(P('CLK')));
      if (others.length) add('warn', `${L} 和 ${others.map(moduleLabel).join('、')} 接在同一個 STEP 輸出`, '兩顆馬達會收到一模一樣的脈波，沒辦法分開控制速度。改接另一組 STEP 輸出。', netPins(P('CLK')));
      if (!code.step) add('warn', '程式沒有啟動計時器 PWM', 'CLK 接好了，但程式沒有開啟計時器的 PWM 輸出，馬達不會轉。按「載入範例程式」可以看到這顆晶片 SDK 的寫法。');
    }
  }
  // ---- 錯誤旗標 ----
  const lo0 = I('LO0'), lo1 = I('LO1');
  for (const [n, i] of [['LO0', lo0], ['LO1', lo1]]) if (i.v33 || i.v5 || i.gnd || i.src) add('err', `${L} 的 ${n} 接到 ${at(n)}`, `${n} 是驅動板的「輸出」（開汲極錯誤旗標），要接 MCU 的 GPIO 輸入，不能接電源或地。`, netPins(P(n)));
  if (lo0.gpio.length || lo1.gpio.length){
    const p = (lo0.gpio[0] || lo1.gpio[0]), both = net(P('LO0')).includes(P('LO1'));
    add('ok', `${L} ${both ? 'LO0＋LO1' : lo0.gpio.length ? 'LO0' : 'LO1'} → ${pinName(p)}`, both ? '兩個開汲極旗標並接：任何一種錯誤（過電流、斷線、過熱）都會把這支腳拉低。' : '開汲極輸出，平常被上拉成高電位，出錯時變低電位。', netPins(P(lo0.gpio.length ? 'LO0' : 'LO1')));
    if (!code.ins.has(p)) add('warn', `程式沒有讀取 ${p}（${L} 的錯誤旗標）`, '程式可以定時讀這支腳，變低電位時把 STANDBY 拉低再拉高來清除錯誤。按「載入範例程式」看寫法。', netPins(P('LO0')));
  } else add('info', `${L} 的 LO0／LO1 沒有接`, '可以不接，但驅動板出錯（過電流、馬達斷線、過熱）時程式不會知道。接到一支 GPIO 輸入，LO1 可以並接到 LO0。', ['LO0', 'LO1'].map(P));
  // ---- 5 V 輸出 ----
  const vc = I('VCC');
  if (vc.v33 || vc.v5 || vc.gnd || vc.gpio.length) add('err', `${L} 的 VCC 接到 ${vc.gpio.length ? pinName(vc.gpio[0]) : vc.gnd ? 'GND' : vc.v5 ? '5V' : '3V3'}`, 'VCC 是驅動板內部穩壓器的 5 V 輸出（只有約 5 mA），不能接到電源軌、地或 MCU 腳位。只能拿來拉高 STBY、EN 這類邏輯輸入，或不接。', netPins(P('VCC')));
  // ---- 輸出與馬達 ----
  const OUT = ['A+', 'A-', 'B+', 'B-'];
  for (const n of OUT){ const i = I(n); if (i.gnd || i.v33 || i.v5 || i.gpio.length || net(P(n)).some(x => /\.(V[+-]|VIN|PGND|VCC)$/.test(x))) add('err', `${L} 的 ${n} 短路到 ${at(n)}`, '馬達輸出只能接馬達線。接到地、電源或 MCU 腳位時，一打開 ENABLE 就會觸發過電流保護（ISD），而且 MCU 腳位會燒毀。', netPins(P(n))); }
  const mot = motorOfDriver(m);
  if (!mot){ add('err', `${L} 沒有接馬達`, '把步進馬達的四條線接到右側的 A+、A−、B+、B−。沒有接馬達就打開 ENABLE，驅動板會偵測到「馬達斷線（OPD）」並關閉輸出。', OUT.map(P)); }
  else {
    const cm = coilMap(mot), ML = moduleLabel(mot), pins = [...OUT.map(n => P(n)), ...OUT.map(n => `${mot.id}.${n}`)];
    const desc = co => `${co.a || '（沒接）'}／${co.b || '（沒接）'}`;
    if (cm.bad === 'open') add('err', `${ML} 有馬達線沒接好`, `馬達的 A+／A− 接到驅動板的 ${desc(cm.A)}，B+／B− 接到 ${desc(cm.B)}。一組線圈斷線時驅動板會偵測到 OPD（LO1 變低）並關閉輸出。`, pins);
    else if (cm.bad === 'mix') add('err', `${ML} 的線圈接錯相`, `馬達的 A+／A− 接到驅動板的 ${desc(cm.A)}，B+／B− 接到 ${desc(cm.B)}。同一組線圈的兩條線要接到同一相（A+ 和 A−，或 B+ 和 B−）。接錯會讓兩個 H 橋經由線圈互相短路，觸發過電流保護（ISD）。用三用電表量：兩條線之間有幾歐姆電阻的就是同一組線圈。`, pins);
    else if (cm.bad === 'short') add('err', `${ML} 的線接在一起了`, '兩條馬達線接到驅動板的同一支輸出，線圈被短路。', pins);
    else if (cm.normal) add('ok', `${L} A+／A−／B+／B− → ${ML}`, '線序正確：A 相接線圈 A、B 相接線圈 B。', pins);
    else add('info', `${ML} 的線序和標準不同`, `馬達的 A+／A− 接到驅動板的 ${desc(cm.A)}，B+／B− 接到 ${desc(cm.B)}。這樣也能轉，${cm.sigma < 0 ? '但方向會相反（DIR 高電位時逆時針）。要改回來，把其中一組線圈的兩條線對調。' : '方向不變（兩組都反接，等於整體轉了 180° 電氣角）。'}`, pins);
    const mv = variantOf(mot.type, mot.variant), I0 = st.ilim;
    if (I0 > mv.rated * 1.1) add('warn', `${L} 的電流限制 ${I0.toFixed(2)} A 超過 ${ML} 的額定 ${mv.rated} A`, `VREF ${st.vref.toFixed(2)} V × 1.56 ＝ ${I0.toFixed(2)} A。馬達會過熱。把 VREF 調到 ${(mv.rated / 1.56).toFixed(2)} V 以下。`);
    if (I0 > 2.1 && v.heat > 20) add('warn', `${L} 電流 ${I0.toFixed(2)} A，沒有散熱片`, '超過約 2.1 A 時晶片會越來越燙，大約 20 秒就會過熱保護（TSD）。降低 VREF，或換成「附散熱片」的型號。');
    else if (I0 <= mv.rated * 1.1) add('ok', `${L} 電流限制 ${I0.toFixed(2)} A（VREF ${st.vref.toFixed(2)} V）`, `I ＝ VREF × 1.56。${ML} 額定 ${mv.rated} A，${I0 < mv.rated * .4 ? '電流偏小，扭力會很弱、容易失步。' : '扭力約為額定的 ' + Math.round(I0 / mv.rated * 100) + '%。'}`);
  }
  if (m.st.damaged) add('err', `${L} 已經燒毀`, '先前有邏輯腳接到了馬達電源（超過 5.5 V）。改好接線後換一塊新的。', [P('STBY')], { label:'換一塊新的驅動板', fn:() => { m.st.damaged = false; drvOf(m).fault = null; hooks.toast('已換上新的 TB67S128FTG 驅動板。'); hooks.recheck(); } });
  if (ds.fault) add('warn', `${L} 目前鎖在錯誤狀態：${FAULTS[ds.fault].name}`, `${FAULTS[ds.fault].why} 旗標：${FAULTS[ds.fault].lo}。改好之後把 STANDBY 拉低再拉高（範例程式偵測到 LO 變低時會自動做），或關掉馬達電源再打開。`, ['LO0', 'LO1'].map(P));
}
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
    else if (s.type === 'rails') add('err', '電源互接：3V3 與 5V 接在一起', '兩組不同電壓的電源直接相連，穩壓器會互相灌電流。', pins);
    else if (s.type === 'hv') add('err', `${moduleLabel(s.psu)} 的 ${variantOf(s.psu.type, s.psu.variant).v} V 接到開發板`, `馬達電源的 V+ 碰到 MCU 的 3V3／5V 或 GPIO。真的開發板會燒毀（MCU 最高只能承受約 3.6 V）。模擬器先切斷開發板的電源；V+ 只能接驅動板的 VIN。`, pins);
    else add('err', `${moduleLabel(s.psu)} 短路：V+ 直接接到地`, '變壓器的短路保護會關閉輸出，驅動板沒有電。V+ 接驅動板 VIN、V− 接驅動板 PGND。', pins);
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
      case 'tb67': tb67Checks(m, v, { add, hasWire, netPins, pinsOr, code, pinName }); break;
      case 'motor': {
        const cm = coilMap(m), label = moduleLabel(m);
        for (const n of ['A+', 'A-', 'B+', 'B-']){
          const i = netInfo(P(n));
          if (i.gpio.length || i.v33 || i.v5 || i.gnd || i.src) add('err', `${label} 的 ${n} 接到${i.gpio.length ? ` ${pinName(i.gpio[0])}` : i.gnd ? ' GND' : '電源'}`, i.gpio.length ? '馬達線不能直接接 MCU：GPIO 只能輸出約 20 mA，馬達每一相要 1–2 A，而且線圈需要正反兩個方向的電流。中間一定要經過驅動板（A+／A−／B+／B−）。' : '馬達線只能接到驅動板的 A+／A−／B+／B−，接到電源或地會短路。', netPins(P(n)));
        }
        if (!cm.drv) add('err', `${label} 沒有接到驅動板`, '四條馬達線要接到 TB67S128FTG 驅動板的 A+、A−、B+、B−（常見顏色：A+ 黑、A− 綠、B+ 紅、B− 藍）。', T.pins.map(([n]) => P(n)));
        else if (cm.multi) add('warn', `${label} 接到兩塊驅動板`, '一顆馬達只能由一塊驅動板控制，兩塊驅動板的輸出會互相拉扯。', T.pins.map(([n]) => P(n)));
        break;
      }
      case 'psu': {
        const label = moduleLabel(m), vv = v.v;
        const drvs = bench.modules.filter(d => d.type === 'tb67' && net(`${d.id}.VIN`).includes(P('V+')));
        if (m.st.on === false) add('info', `${label} 的開關是關的`, '驅動板沒有馬達電源，馬達不會動。到「元件」分頁打開電源開關。');
        if (drvs.length) add('ok', `${label} V+ → ${drvs.map(d => `${moduleLabel(d)} VIN`).join('、')}`, `${vv} V 馬達電源。${vv < 6.5 ? '但 TB67S128FTG 至少要 6.5 V！' : ''}`, netPins(P('V+')));
        else if (hasWire(P('V+')) && !netInfo(P('V+')).gpio.length && !netInfo(P('V+')).v33 && !netInfo(P('V+')).v5) add('warn', `${label} 的 V+ 沒有接到驅動板的 VIN`, 'V+ 要接 TB67S128FTG 驅動板右側的 VIN。', netPins(P('V+')));
        if (!hasWire(P('V-'))) add('err', `${label} 的 V− 沒有接`, 'V− 接驅動板的 PGND，電流才有回路。', [P('V-')]);
        else if (netInfo(P('V-')).gnd) add('ok', `${label} V− 和 MCU 共地`, '馬達電源的負極、驅動板的 GND、MCU 的 GND 連在一起，STEP／DIR 訊號才有共同的參考電位。', netPins(P('V-')));
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
