// 接線檢測規則：每條結果為 { sev:'err'|'warn'|'ok'|'info', title, detail, pins, action? }
import { MODULE_TYPES, variantOf } from './parts.js';
import { bench, wires, NET, SIM, net, netInfo, shorts, nodeOf, isGpioName, moduleLabel, headerPin, PINS } from './sim.js';
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
    adc:/HAL_ADC_GetValue|DL_ADC12_getMemResult|ADC\w*_getResults|ADCSequenceDataGet|ADC_readResult|ADC16_GetChannelConversionValue|LPADC_GetConvResult|ADC_GetChannelConversion/.test(code) };
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

  for (const h of b.header.filter(x => x.tags.includes('vcp')))
    if ([...wired].some(id => nodeOf(id) === h.mcu)) add('warn', `${pinName(h.mcu)} 是虛擬序列埠腳位`, `${h.mcu} 連到 ${b.vcp.periph}，printf 從這裡輸出。接外部裝置會干擾序列埠。`, netPins(h.mcu));
  for (const h of b.header.filter(x => x.tags.includes('led'))){
    const led = b.leds.find(l => l.pin === h.mcu);
    if ([...wired].some(id => nodeOf(id) === h.mcu)) add('info', `${pinName(h.mcu)} 同時連到板載 ${led.name}`, `這支腳在板上也接著 ${led.name}，輸出時板載 LED 會一起亮。`, netPins(h.mcu));
  }
  if (!SIM.usb) add('info', 'USB 沒有接上', '開發板沒有供電。接線檢測仍可進行，但程式無法燒錄與執行。');
  const rank = { err:0, warn:1, ok:2, info:3 };
  return out.sort((a, b2) => rank[a.sev] - rank[b2.sev]);
}
