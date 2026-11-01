// 接線檢測規則：每條規則回傳 { sev, title, detail, pins, action? }
import { nodeOf, isGpioName } from './board.js';
import { wires, NET, SIM, net, netInfo, shorts } from './sim.js';
import { stripCode } from './compiler.js';
import { hooks } from './hooks.js';

/* ================= 接線檢測 ================= */
export function analyzeCode(src){
  const code = stripCode(src, false), outs = new Set(), ins = new Set(); let m;
  const masks = (port, expr) => (expr.match(/GPIO_PIN_(\d+)/g) || []).map(x => 'P' + port + x.slice(9));
  const reW = /HAL_GPIO_(?:WritePin|TogglePin)\s*\(\s*GPIO([A-K])\s*,([^,)]+)/g;
  while ((m = reW.exec(code))) masks(m[1], m[2]).forEach(p => outs.add(p));
  const reR = /HAL_GPIO_ReadPin\s*\(\s*GPIO([A-K])\s*,([^)]+)\)/g;
  while ((m = reR.exec(code))) masks(m[1], m[2]).forEach(p => ins.add(p));
  return { outs, ins, i2c:/\bhi2c1\b/.test(code) };
}
export function runChecks(src){
  const out = [], add = (sev, title, detail, pins = [], action) => out.push({ sev, title, detail, pins, action });
  const code = analyzeCode(src);
  const wired = new Set(); wires.forEach(w => { wired.add(w.a); wired.add(w.b); });
  const netPins = k => { const ms = new Set(net(k)); return [...wired].filter(id => ms.has(nodeOf(id))); };
  const used = key => [...wired].some(id => id.startsWith(key + '.'));
  const list = s => [...s].join('、') || '（沒有）';
  if (!wires.length){ add('info', '還沒有接任何線', '在 3D 畫面依序點兩個金色腳位，或到「接線」分頁新增。也可以先按「範例接線」。'); return out; }

  for (const s of shorts()){
    const pins = [...wired].filter(id => s.ms.includes(nodeOf(id)));
    if (s.type === 'gnd') add('err', `短路：${s.ms.includes('5V') ? '5V' : '3V3'} 直接接到 GND`, '電源與地之間沒有任何負載。通電後 USB 過電流保護會切斷電源，整塊板子停止運作。', pins);
    else add('err', '電源互接：3V3 與 5V 接在一起', '兩組不同電壓的電源直接相連，穩壓器會互相灌電流。', pins);
  }
  for (const ms of Object.values(NET.groups)){
    const gp = ms.filter(isGpioName); if (!gp.length) continue;
    const s = new Set(ms), rail = s.has('GND') ? 'GND' : s.has('3V3') ? '3V3' : s.has('5V') ? '5V' : null;
    if (rail && !ms.some(x => x.includes('.')))
      add('warn', `${gp.join('、')} 直接接到 ${rail}`, `程式若把這支腳設成輸出${rail === 'GND' ? '高' : '低'}電位，就會變成短路。中間應該經過模組或限流電阻。`, netPins(gp[0]));
    if (gp.length > 1) add('warn', `${gp.join(' 與 ')} 接在一起`, '兩支 GPIO 同時當輸出且電位不同時會互相拉扯，可能損壞腳位。', netPins(gp[0]));
  }

  // LED 模組
  if (!used('LED')) add('info', 'LED 模組沒有使用', '沒有接線，略過檢查。');
  else {
    const s = netInfo('LED.SIG'), g = netInfo('LED.GND');
    if (!wired.has('LED.SIG')) add('err', 'LED 的 SIG 沒有接', 'SIG 要接到一支 GPIO（例如 PA5），程式才能控制亮滅。', ['LED.SIG']);
    else if (s.gnd) add('err', 'LED 的 SIG 接到 GND', '訊號端接地，LED 永遠不會亮。', netPins('LED.SIG'));
    else if (s.v33 || s.v5) add('warn', 'LED 的 SIG 接到電源', 'LED 會一直亮，程式無法控制。改接到 GPIO。', netPins('LED.SIG'));
    else if (s.gpio.length){
      const p = s.gpio[0];
      add('ok', `LED SIG → ${p}`, `由 ${p} 控制，輸出高電位時點亮。`, netPins('LED.SIG'));
      if (!code.outs.has(p)) add('warn', `程式沒有控制 ${p}`, `目前程式輸出的腳位是 ${list(code.outs)}。把 HAL_GPIO_WritePin／TogglePin 改成 GPIO${p[1]}, GPIO_PIN_${p.slice(2)}，或把線改接到程式用的腳位。`, netPins('LED.SIG'));
    } else if (s.m.includes('BTN.OUT')) add('ok', 'LED SIG → 按鈕 OUT', '按下按鈕時 LED 直接點亮，不經過 MCU。', netPins('LED.SIG'));
    else add('err', 'LED 的 SIG 沒有接到開發板', 'SIG 只接到其他模組，沒有 GPIO 能控制它。', netPins('LED.SIG'));
    if (g.gnd) add('ok', 'LED GND → GND', '電流回路完整。', netPins('LED.GND'));
    else add('err', 'LED 的 GND 沒有接地', '沒有回路，LED 不會亮。接到 J1 上任一支 GND。', wired.has('LED.GND') ? netPins('LED.GND') : ['LED.GND']);
  }

  // 按鈕模組
  if (!used('BTN')) add('info', '按鈕模組沒有使用', '沒有接線，略過檢查。');
  else {
    const v = netInfo('BTN.VCC'), o = netInfo('BTN.OUT'), g = netInfo('BTN.GND');
    if (v.v33) add('ok', '按鈕 VCC → 3V3', '按下時 OUT 輸出 3.3 V。', netPins('BTN.VCC'));
    else if (v.v5) add('warn', '按鈕 VCC 接到 5V', '按下時會把 5 V 送進 GPIO。部分腳位不耐 5 V，建議改接 3V3。', netPins('BTN.VCC'));
    else add('err', '按鈕 VCC 沒有接電源', '沒有電源時，不論是否按下 OUT 都是低電位。', wired.has('BTN.VCC') ? netPins('BTN.VCC') : ['BTN.VCC']);
    if (g.gnd) add('ok', '按鈕 GND → GND', '下拉電阻有接地，放開時 OUT 為低電位。', netPins('BTN.GND'));
    else add('err', '按鈕 GND 沒有接地', '下拉電阻沒有接地，放開時 OUT 會浮接，讀值不穩定。', wired.has('BTN.GND') ? netPins('BTN.GND') : ['BTN.GND']);
    if (o.gpio.length){
      const p = o.gpio[0];
      add('ok', `按鈕 OUT → ${p}`, `用 HAL_GPIO_ReadPin 讀 ${p} 取得按鈕狀態。`, netPins('BTN.OUT'));
      if (!code.ins.has(p)) add('warn', `程式沒有讀取 ${p}`, `目前程式讀取的腳位是 ${list(code.ins)}。改用 HAL_GPIO_ReadPin(GPIO${p[1]}, GPIO_PIN_${p.slice(2)})。`, netPins('BTN.OUT'));
    } else if (o.m.includes('LED.SIG')) { /* 已在 LED 項目說明 */ }
    else if (o.v33 || o.v5 || o.gnd) add('err', '按鈕 OUT 接到電源或地', 'OUT 是訊號輸出，應該接到 GPIO。', netPins('BTN.OUT'));
    else add('err', '按鈕 OUT 沒有接到 GPIO', '接到 J1 上的任一支 GPIO，例如 PA0。', wired.has('BTN.OUT') ? netPins('BTN.OUT') : ['BTN.OUT']);
  }

  // I2C 感測器
  if (!used('SEN')){
    if (code.i2c) add('warn', '程式使用 I2C1，但感測器沒有接', 'HAL_I2C_Mem_Read 會收不到回應，回傳 HAL_ERROR。', []);
    else add('info', '溫度感測器沒有使用', '沒有接線，略過檢查。');
  } else {
    const v = netInfo('SEN.VCC'), g = netInfo('SEN.GND'), c = netInfo('SEN.SCL'), d = netInfo('SEN.SDA');
    if (v.v33) add('ok', '感測器 VCC → 3V3', '在 1.8–3.6 V 工作範圍內。', netPins('SEN.VCC'));
    else if (v.v5) add('err', '感測器 VCC 接到 5V', '這顆感測器最高 3.6 V，5 V 會燒毀晶片。改接 3V3。', netPins('SEN.VCC'));
    else add('err', '感測器沒有接電源', 'VCC 要接到 3V3。', wired.has('SEN.VCC') ? netPins('SEN.VCC') : ['SEN.VCC']);
    if (g.gnd) add('ok', '感測器 GND → GND', '接地正確。', netPins('SEN.GND'));
    else add('err', '感測器 GND 沒有接地', '接到 J1 上任一支 GND。', wired.has('SEN.GND') ? netPins('SEN.GND') : ['SEN.GND']);
    const swapped = c.gpio.includes('PB9') && d.gpio.includes('PB8');
    if (swapped) add('err', 'SCL 與 SDA 接反', 'I2C1 的 SCL 在 PB8、SDA 在 PB9。把兩條線對調。', [...netPins('SEN.SCL'), ...netPins('SEN.SDA')]);
    for (const [pin, want, info, name] of [['SEN.SCL', 'PB8', c, 'SCL'], ['SEN.SDA', 'PB9', d, 'SDA']]){
      if (swapped) continue;
      if (info.gpio.includes(want)) add('ok', `感測器 ${name} → ${want}`, `${want} 是 I2C1_${name}。`, netPins(pin));
      else if (info.gpio.length) add('err', `感測器 ${name} 接到 ${info.gpio[0]}`, `這支腳不是 I2C1。本板 J1 上的 I2C1 在 PB8（SCL）和 PB9（SDA）。`, netPins(pin));
      else add('err', `感測器 ${name} 沒有接到開發板`, `${name} 要接到 ${want}。`, wired.has(pin) ? netPins(pin) : [pin]);
    }
    if (SIM.senDamaged) add('err', '感測器已經損壞', '先前通電時 VCC 接到 5V。改好接線後換一顆新的。', ['SEN.VCC'], { label:'更換感測器', fn:() => { SIM.senDamaged = false; hooks.sensorDamaged(false); hooks.toast('已換上新的感測器。'); hooks.recheck(); } });
    if (!code.i2c) add('info', '程式沒有使用 I2C', '感測器已接好，但程式沒有呼叫 HAL_I2C_Mem_Read 讀取它。');
  }
  for (const p of ['PD8', 'PD9']) if ([...wired].some(id => nodeOf(id) === p))
    add('warn', `${p} 是虛擬序列埠腳位`, 'PD8／PD9 連到 ST-LINK 的 USART3，printf 從這裡輸出。接外部裝置會干擾序列埠。', netPins(p));
  if (!SIM.usb) add('info', 'USB 沒有接上', '開發板沒有供電，接線檢測仍可進行，但程式無法燒錄與執行。');
  const rank = { err:0, warn:1, ok:2, info:3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}
