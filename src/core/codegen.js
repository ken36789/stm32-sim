// 依目前的開發板與模組產生「建議接線」與「範例 main.c」
import { MODULE_TYPES, variantOf } from './parts.js';
import { bench, netInfo, moduleLabel, isAnalyzer } from './sim.js';
import { sdkFor } from './sdk.js';
import { SPI_TYPES, SPI_PINS } from './buses.js';
import { drvStatus, motorOfDriver } from './steppers.js';

const SIGNAL = { led:['SIG'], rgb:['R', 'G', 'B'], button:['OUT'], pir:['OUT'], buzzer:['SIG'], relay:['IN'], pot:['OUT'] };

/** 建議接線：回傳 [[腳位, 腳位], …]。電源經由電源軌分配；I2C、SPI 匯流排上的元件與分析儀探棒以串接方式共用同一條線。 */
export function suggestWiring(){
  const b = bench.board, H = b.header, pairs = [], used = new Set();
  const id = label => H.find(h => h.label === label && !used.has(h.id))?.id;
  const take = label => { const x = id(label); if (x) used.add(x); return x; };
  const byMcu = mcu => H.find(h => h.mcu === mcu)?.label;
  const p3 = take('3V3'), g = take('GND');
  pairs.push([p3, 'R.+1'], [g, 'R.-1']);
  let plus = 2, minus = 2;
  const rail = s => s === '+' ? `R.+${plus++}` : `R.-${minus++}`;
  const BUS = ['scl', 'sda', 'vcp', 'led', 'sck', 'miso', 'mosi', 'cantx', 'canrx', 'cs', 'step'];
  const avoid = h => h.kind !== 'gpio' || ['scl', 'sda', 'vcp', 'led'].some(t => h.tags.includes(t)) || (b.btn && h.mcu === b.btn.pin);
  const rank = h => (BUS.some(t => h.tags.includes(t)) ? 10 : 0) + (/^D([2-9]|1[0-2])$/.test(h.label) ? 0 : /^D/.test(h.label) ? 2 : 1);
  const digital = H.filter(h => !avoid(h) && !h.tags.includes('adc')).sort((x, y) => rank(x) - rank(y));
  const analog = H.filter(h => !avoid(h) && h.tags.includes('adc')).sort((x, y) => rank(x) - rank(y));
  const nextPin = list => { const h = list.find(x => !used.has(x.id)); if (h) used.add(h.id); return h?.id; };
  // 匯流排串接：每條線記住目前的尾端，新的元件接到尾端（排針每孔一條線，模組腳位最多兩條）
  const tail = {};
  const chain = (role, startLabel, pin) => { if (!(role in tail)) tail[role] = startLabel ? take(startLabel) : null; if (tail[role]) pairs.push([tail[role], pin]); tail[role] = pin; };
  const power = (m, v) => {
    const pins = MODULE_TYPES[m.type].pins.map(p => p[0]), P = n => `${m.id}.${n}`;
    if (pins.includes('VCC')) pairs.push([v.vmin > 3.6 ? (take('5V') || rail('+')) : rail('+'), P('VCC')]);
    if (pins.includes('GND')) pairs.push([rail('-'), P('GND')]);
  };
  const devices = bench.modules.filter(m => !isAnalyzer(m)), analyzers = bench.modules.filter(isAnalyzer);
  let firstSpi = null, nStep = 0;
  // 驅動板的訊號腳：數位腳不夠時也可以用類比腳（大多數 MCU 的類比腳也能當 GPIO）
  const gpioPin = () => nextPin(digital) || nextPin(analog);
  const drivers = devices.filter(m => m.type === 'tb67'), motors = devices.filter(m => m.type === 'motor'), psu = devices.find(m => m.type === 'psu');
  drivers.forEach((d, k) => {
    const P = n => `${d.id}.${n}`, mot = motors[k];
    // 馬達電源：變壓器 V+ → VIN、V− → PGND（變壓器每支腳最多兩條線，第三塊以後從前一塊驅動板串接）
    if (psu){ pairs.push([k < 2 ? `${psu.id}.V+` : `${drivers[k - 1].id}.VIN`, P('VIN')], [k < 2 ? `${psu.id}.V-` : `${drivers[k - 1].id}.PGND`, P('PGND')]); }
    pairs.push([rail('-'), P('GND')], [rail('+'), P('IOREF')]);             // 和 MCU 共地；邏輯電位 3.3 V
    const clk = b.step && nStep < b.step.length ? take(b.step[nStep].pin) : gpioPin(); nStep++;
    pairs.push([clk, P('CLK')]);
    for (const n of ['DIR', 'EN', 'STBY']) pairs.push([gpioPin(), P(n)]);
    pairs.push([gpioPin(), P('LO0')], [P('LO0'), P('LO1')]);                // 兩個開汲極錯誤旗標並接到同一支 GPIO
    if (mot) for (const n of ['A+', 'A-', 'B+', 'B-']) pairs.push([P(n), `${mot.id}.${n}`]);
  });
  for (const m of devices){
    if (m.type === 'tb67' || m.type === 'motor' || m.type === 'psu') continue;
    const v = variantOf(m.type, m.variant), P = n => `${m.id}.${n}`;
    power(m, v);
    if (m.type === 'temp'){ chain('scl', b.i2c.scl, P('SCL')); chain('sda', b.i2c.sda, P('SDA')); continue; }
    if (SPI_TYPES.includes(m.type)){
      if (!b.spi) continue;
      const N = SPI_PINS[m.type];
      chain('sck', b.spi.sck, P(N.sck)); chain('miso', b.spi.miso, P(N.miso)); if (N.mosi) chain('mosi', b.spi.mosi, P(N.mosi));
      const cs = !firstSpi ? take(b.spi.cs) || nextPin(digital) : nextPin(digital);
      if (cs) pairs.push([cs, P('CS')]);
      if (!firstSpi) firstSpi = m;
      continue;
    }
    if (m.type === 'stepper'){
      const k = nStep++;
      if (b.step && k < b.step.length) pairs.push([take(b.step[k].pin), P('CLK')]);
      for (const n of ['CW', 'EN']){ const h = nextPin(digital); if (h) pairs.push([h, P(n)]); }
      continue;
    }
    if (m.type === 'can'){ if (b.can){ pairs.push([take(b.can.tx), P('TXD')], [take(b.can.rx), P('RXD')]); tail.canh = P('CANH'); tail.canl = P('CANL'); } continue; }
    for (const n of SIGNAL[m.type] || []){ const h = nextPin(m.type === 'pot' ? analog : digital); if (h) pairs.push([h, P(n)]); }
  }
  for (const m of analyzers){
    const P = n => `${m.id}.${n}`;
    pairs.push([rail('-'), P('GND')]);
    if (m.type === 'la_i2c'){ chain('scl', b.i2c.scl, P('SCL')); chain('sda', b.i2c.sda, P('SDA')); }
    if (m.type === 'la_uart'){ chain('utx', byMcu(b.vcp.tx), P('TX')); chain('urx', byMcu(b.vcp.rx), P('RX')); }
    if (m.type === 'la_spi' && b.spi){
      chain('sck', b.spi.sck, P('SCK')); chain('miso', b.spi.miso, P('MISO')); chain('mosi', b.spi.mosi, P('MOSI'));
      const csDev = devices.find(d => d.type === 'flash') || firstSpi;   // 優先看 Flash：指令種類比較多
      if (csDev){ if (!('cs' in tail)) tail.cs = `${csDev.id}.CS`; chain('cs', null, P('CS')); }
    }
    if (m.type === 'la_can' && tail.canh){ chain('canh', null, P('CANH')); chain('canl', null, P('CANL')); }
  }
  return pairs.filter(([a, c]) => a && c);
}

/* ---------- 範例程式（依開發板的 SDK 產生） ---------- */
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

/** 找出模組某支腳實際（或建議）接到的 MCU 腳位 */
function signalMcu(m, n, suggested){
  const g = netInfo(`${m.id}.${n}`).gpio[0];
  if (g) return g;
  const pair = suggested.find(([a, c]) => c === `${m.id}.${n}`);
  return pair ? bench.board.header.find(h => h.id === pair[0])?.mcu : null;
}

/** 感測器驅動程式：只透過 I2C_Write／I2C_Read（7 位元位址），所以各家 SDK 共用 */
function driver(v, s, A, sdk, b, U8){
  const P = sdk.print, D = ms => sdk.delay(ms, b);
  const ret = sdk.float ? '-999.0f' : '-999.0f';
  switch (v.dev){
    case 'bmx280': return `static uint16_t ${s}_T1;
static int16_t ${s}_T2;
static int16_t ${s}_T3;

static int ${s}_Init(void)
{
  ${U8} id[1];
  ${U8} c[6];
  ${U8} mode[2] = {0xF4, 0x27};        // ctrl_meas：溫度、氣壓各取樣 1 次，正常模式
  if (!I2C_ReadReg(${A}, 0xD0, id, 1)) return 0;
  ${P}("${v.part} 晶片 ID = 0x%02X\\r\\n", id[0]);
  I2C_Write(${A}, mode, 2);
  I2C_ReadReg(${A}, 0x88, c, 6);       // 校正值 dig_T1..T3
  ${s}_T1 = c[0] | (c[1] << 8);
  ${s}_T2 = (int16_t)(c[2] | (c[3] << 8));
  ${s}_T3 = (int16_t)(c[4] | (c[5] << 8));
  return 1;
}

// datasheet 的 32 位元整數補償公式
static float ${s}_Read(void)
{
  ${U8} d[3];
  if (!I2C_ReadReg(${A}, 0xFA, d, 3)) return ${ret};
  int32_t adc = ((int32_t)d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
  int32_t var1 = (((adc >> 3) - ((int32_t)${s}_T1 << 1)) * ((int32_t)${s}_T2)) >> 11;
  int32_t var2 = (((((adc >> 4) - ((int32_t)${s}_T1)) * ((adc >> 4) - ((int32_t)${s}_T1))) >> 12) * ((int32_t)${s}_T3)) >> 14;
  return (((var1 + var2) * 5 + 128) >> 8) / 100.0f;
}`;
    case 'lm75':
    case 'tmp102': {
      const shift = v.dev === 'lm75' ? 5 : 4, lsb = v.dev === 'lm75' ? '0.125f' : '0.0625f';
      return `static int ${s}_Init(void)
{
  ${U8} d[2];
  return I2C_ReadReg(${A}, 0x00, d, 2);
}

static float ${s}_Read(void)
{
  ${U8} d[2];
  if (!I2C_ReadReg(${A}, 0x00, d, 2)) return ${ret};
  int16_t raw = (int16_t)((d[0] << 8) | d[1]) >> ${shift};   // ${v.dev === 'lm75' ? '11' : '12'} 位元，左對齊
  return raw * ${lsb};
}`;
    }
    case 'mcp9808': return `static int ${s}_Init(void)
{
  ${U8} id[2];
  if (!I2C_ReadReg(${A}, 0x06, id, 2)) return 0;
  ${P}("MCP9808 製造商 ID = 0x%02X%02X\\r\\n", id[0], id[1]);
  return 1;
}

static float ${s}_Read(void)
{
  ${U8} d[2];
  if (!I2C_ReadReg(${A}, 0x05, d, 2)) return ${ret};
  int16_t raw = (int16_t)(((d[0] & 0x1F) << 8) | d[1]);
  if (raw & 0x1000) raw -= 0x2000;                  // 負溫度
  return raw * 0.0625f;
}`;
    case 'hdc1080': return `static int ${s}_Init(void)
{
  ${U8} id[2];
  if (!I2C_ReadReg(${A}, 0xFF, id, 2)) return 0;
  ${P}("HDC1080 裝置 ID = 0x%02X%02X\\r\\n", id[0], id[1]);
  return 1;
}

static float ${s}_Read(void)
{
  ${U8} cmd[1] = {0x00};
  ${U8} d[2];
  if (!I2C_Write(${A}, cmd, 1)) return ${ret};
  ${D(10)}                                    // 轉換時間約 6.35 ms
  if (!I2C_Read(${A}, d, 2)) return ${ret};
  return ((d[0] << 8) | d[1]) * 165.0f / 65536.0f - 40.0f;
}`;
    case 'sht3x': return `static float ${s}_RH;

static int ${s}_Init(void)
{
  ${U8} d[3];
  ${U8} cmd[2] = {0xF3, 0x2D};                     // 讀取狀態暫存器
  if (!I2C_Write(${A}, cmd, 2)) return 0;
  return I2C_Read(${A}, d, 3);
}

static float ${s}_Read(void)
{
  ${U8} cmd[2] = {0x24, 0x00};                     // 單次量測、高重複性
  ${U8} d[6];
  if (!I2C_Write(${A}, cmd, 2)) return ${ret};
  ${D(20)}
  if (!I2C_Read(${A}, d, 6)) return ${ret};
  ${s}_RH = 100.0f * ((d[3] << 8) | d[4]) / 65535.0f;
  return -45.0f + 175.0f * ((d[0] << 8) | d[1]) / 65535.0f;
}`;
    case 'aht20': return `static float ${s}_RH;

static int ${s}_Init(void)
{
  ${U8} init[3] = {0xBE, 0x08, 0x00};
  ${D(40)}
  return I2C_Write(${A}, init, 3);
}

static float ${s}_Read(void)
{
  ${U8} cmd[3] = {0xAC, 0x33, 0x00};               // 觸發量測
  ${U8} d[7];
  if (!I2C_Write(${A}, cmd, 3)) return ${ret};
  ${D(80)}
  if (!I2C_Read(${A}, d, 7) || (d[0] & 0x80)) return ${ret};
  uint32_t rh = ((uint32_t)d[1] << 12) | (d[2] << 4) | (d[3] >> 4);
  uint32_t t = ((uint32_t)(d[3] & 0x0F) << 16) | (d[4] << 8) | d[5];
  ${s}_RH = rh * 100.0f / 1048576.0f;
  return t * 200.0f / 1048576.0f - 50.0f;
}`;
  }
  return '';
}

/** SPI 元件驅動程式：只透過 SPI_Xfer 與 CS 腳位，所以各家 SDK 共用 */
function spiDriver(v, s, CS, sdk, b, U8){
  const P = sdk.print, lo = sdk.pin(CS, 0), hi = sdk.pin(CS, 1), D = ms => sdk.delay(ms, b);
  switch (v.dev){
    case 'max6675': return `static float ${s}_Read(void)
{
  ${U8} tx[2] = {0x00, 0x00};
  ${U8} rx[2];
  ${lo}   // CS 拉低：選中 MAX6675
  SPI_Xfer(tx, rx, 2);                   // MAX6675 只送資料，MOSI 送什麼都可以
  ${hi}   // CS 拉高：結束傳輸，晶片開始下一次轉換
  uint16_t v = (rx[0] << 8) | rx[1];
  if (v & 0x0004) return -999.0f;        // D2 = 1：熱電偶沒有接
  return (v >> 3) * 0.25f;               // D14..D3：溫度，每單位 0.25 °C
}`;
    case 'max31855': return `static float ${s}_CJ;

static float ${s}_Read(void)
{
  ${U8} tx[4] = {0x00, 0x00, 0x00, 0x00};
  ${U8} rx[4];
  ${lo}   // CS 拉低：選中 MAX31855
  SPI_Xfer(tx, rx, 4);
  ${hi}
  int32_t v = ((int32_t)rx[0] << 24) | ((int32_t)rx[1] << 16) | ((int32_t)rx[2] << 8) | rx[3];
  ${s}_CJ = ((int16_t)(v & 0xFFF0) >> 4) * 0.0625f;    // D15..D4：冷接點（晶片本身）溫度
  if (v & 0x00010000) return -999.0f;                  // D16 = 1：故障（斷線或短路）
  return (v >> 18) * 0.25f;                            // D31..D18：熱電偶溫度（有號數）
}`;
    case 'w25q': return `static void ${s}_Cmd(${U8} *tx, ${U8} *rx, int len)
{
  ${lo}   // CS 拉低：一個指令開始
  SPI_Xfer(tx, rx, len);
  ${hi}   // CS 拉高：指令結束（寫入、抹除在這時候才開始）
}

static ${U8} ${s}_Status(void)
{
  ${U8} tx[2] = {0x05, 0x00};            // 0x05：讀狀態暫存器 1
  ${U8} rx[2];
  ${s}_Cmd(tx, rx, 2);
  return rx[1];
}

static void ${s}_WaitBusy(void)
{
  while (${s}_Status() & 0x01) {         // BUSY = 1：抹除或寫入還沒完成
    ${D(1)}
  }
}

static void ${s}_WriteEnable(void)
{
  ${U8} tx[1] = {0x06};                  // 0x06：允許寫入（WEL = 1），每次寫入或抹除前都要送
  ${U8} rx[1];
  ${s}_Cmd(tx, rx, 1);
}

static int ${s}_Init(void)
{
  ${U8} id[4] = {0x9F, 0x00, 0x00, 0x00}; // 0x9F：讀 JEDEC ID
  ${U8} rx[4];
  ${U8} se[4] = {0x20, 0x00, 0x00, 0x00}; // 0x20：抹除位址 0 所在的 4 KB 磁區（全部變成 0xFF）
  ${U8} pp[12] = {0x02, 0x00, 0x00, 0x00, 0x4D, 0x43, 0x55, 0x2D, 0x4C, 0x61, 0x62, 0x21};   // 0x02：寫入 "MCU-Lab!"
  ${U8} dummy[12];
  ${s}_Cmd(id, rx, 4);
  ${P}("${v.part} JEDEC ID = %02X %02X %02X\\r\\n", rx[1], rx[2], rx[3]);
  if (rx[1] != 0xEF) return 0;           // 0xEF = Winbond
  ${s}_WriteEnable();
  ${s}_Cmd(se, dummy, 4);
  ${s}_WaitBusy();
  ${s}_WriteEnable();
  ${s}_Cmd(pp, dummy, 12);
  ${s}_WaitBusy();
  return 1;
}

static void ${s}_Read8(${U8} *out)
{
  ${U8} tx[12] = {0x03, 0x00, 0x00, 0x00}; // 0x03：從位址 0x000000 開始讀
  ${U8} rx[12];
  ${s}_Cmd(tx, rx, 12);
  for (int i = 0; i < 8; i++) out[i] = rx[4 + i];
}`;
  }
  return '';
}

/** TB67S128FTG 驅動板（分開接線）：STANDBY → ENABLE → 方向，錯誤旗標 LO0／LO1 並接到一支輸入腳 */
function tb67Channel(d, i, nm, kk, sdk, sug, mods, c, info){
  const { defs, define, pre, drivers, report, stepInit, pinLabel, P, b } = c, sig = n => signalMcu(d, n, sug);
  const mot = motorOfDriver(d) || mods.filter(m => m.type === 'motor')[mods.filter(m => m.type === 'tb67').indexOf(d)];
  const mv = mot ? variantOf(mot.type, mot.variant) : { step:1.8 }, div = drvStatus(d).div, label = moduleLabel(d);
  for (const [pin, suffix, note] of [['STBY', 'STBY', 'STANDBY（高電位工作）'], ['EN', 'EN', 'ENABLE（高電位送電給馬達）'], ['DIR', 'DIR', 'CW/CCW（高電位順時針）']])
    if (sig(pin)) define(`${nm}_${suffix}`, sig(pin), `${label} ${pin} → ${pinLabel(sig(pin))}：${note}`, 'out');
  if (sig('LO0')) define(`${nm}_FAULT`, sig('LO0'), `${label} LO0／LO1 → ${pinLabel(sig('LO0'))}：錯誤旗標（低電位＝有錯誤）`, 'in', true);
  const st = sdk.step(b, kk, nm); stepInit.push(...st.init); drivers.push(st.fn);
  if (sig('STBY')) pre.push(sdk.pin(`${nm}_STBY`, 1) + `   // ${label}：離開待機（STANDBY 高電位）`);
  if (sig('EN')) pre.push(sdk.pin(`${nm}_EN`, 1) + `   // ${label}：打開輸出（ENABLE 高電位）`);
  if (sig('DIR')) pre.push(sdk.pin(`${nm}_DIR`, 1));
  defs.push(`#define ${nm}_MICROSTEP${' '.repeat(Math.max(1, 6 - String(i + 1).length))}${div}       // ${label} 的 MODE2..0（${['000', '001', '010', '011', '100', '101', '110', '111'][Math.log2(div)]}），要和驅動板的設定一樣`,
    `#define ${nm}_STEPS_REV    (${Math.round(360 / mv.step)} * ${nm}_MICROSTEP)   // ${mv.step}° 馬達：一圈 ${Math.round(360 / mv.step)} 個全步 × 微步`);
  if (sig('LO0') && sig('STBY')) report.push(`if (!${sdk.read(`${nm}_FAULT`)}) {          // LO0／LO1 被拉低：驅動板偵測到錯誤（過電流、馬達斷線或過熱）`,
    `  ${P}("${nm}：${label} 回報錯誤，STANDBY 拉低再拉高來清除\\r\\n");`, `  ${sdk.pin(`${nm}_STBY`, 0)}`, `  ${sdk.delay(1, b)}`, `  ${sdk.pin(`${nm}_STBY`, 1)}`, '}');
  info.push({ nm, m:d, i, dir:!!sig('DIR') });
}

/** 步進馬達：M1 來回移動（梯形加減速），M2 連續轉動（速度跟著旋鈕或定時切換，加速度受限） */
function stepperCode(b, sdk, mods, sug, c){
  const { defs, define, pre, drivers, loop, report, stepInit, pinLabel, P } = c;
  const steppers = mods.filter(m => m.type === 'stepper' || m.type === 'tb67').slice(0, 2);
  const pot = mods.find(m => m.type === 'pot');
  const info = [];
  steppers.forEach((m, i) => {
    const nm = `M${i + 1}`, sig = n => signalMcu(m, n, sug), clk = sig('CLK'), k = b.step.findIndex(x => b.header.find(h => h.label === x.pin)?.mcu === clk);
    const kk = k >= 0 ? k : i;
    if (m.type === 'tb67'){ tb67Channel(m, i, nm, kk, sdk, sug, mods, c, info); return; }
    const v = variantOf(m.type, m.variant), mo = { div:m.st.mot ? m.st.mot.jdiv : 16 };
    if (sig('CW')) define(`${nm}_DIR`, sig('CW'), `${moduleLabel(m)} CW → ${pinLabel(sig('CW'))}（高電位順時針）`, 'out');
    if (sig('EN')) define(`${nm}_EN`, sig('EN'), `${moduleLabel(m)} EN → ${pinLabel(sig('EN'))}（高電位啟用）`, 'out');
    const st = sdk.step(b, kk, nm); stepInit.push(...st.init); drivers.push(st.fn);
    if (sig('EN')) pre.push(sdk.pin(`${nm}_EN`, 1) + `   // 啟用${moduleLabel(m)}的驅動`);
    if (sig('CW')) pre.push(sdk.pin(`${nm}_DIR`, 1));
    defs.push(`#define ${nm}_MICROSTEP${' '.repeat(Math.max(1, 6 - String(i + 1).length))}${mo.div}       // ${moduleLabel(m)} 的 DMODE 指撥開關（要和模組上的設定一樣）`,
      `#define ${nm}_STEPS_REV    (${Math.round(360 / v.step)} * ${nm}_MICROSTEP)   // ${v.step}° 馬達：一圈 ${Math.round(360 / v.step)} 個全步 × 微步`);
    info.push({ nm, m, i, dir:!!sig('CW') });
  });
  const [a, z] = info;
  if (a){
    defs.push(`#define M1_MAX_PPS     (M1_STEPS_REV * 2)   // 最高速度：每秒 2 圈（120 RPM）`, `#define M1_ACCEL       (M1_STEPS_REV * 4)   // 加速度：每秒增加 4 圈／秒 → 0.5 秒加到最高速`, `#define M1_MOVE        (M1_STEPS_REV * 2)   // 每次移動 2 圈`);
    drivers.push(`// 梯形加減速：每 10 ms 呼叫一次。加速 → 等速 → 在剩下 v²÷(2a) 步的時候開始減速
float m1Pps = 0.0f;       // 目前送出的 STEP 頻率（pps＝每秒脈波數＝每秒微步數）
float m1Pos = 0.0f;       // 這次移動已經送出的步數
int m1Dir = 1;
int m1Wait = 0;

static void M1_Update(void)
{
  if (m1Wait > 0) { m1Wait--; return; }                    // 到點後停一下
  float remain = M1_MOVE - m1Pos;                          // 還要走幾步
  float brake = m1Pps * m1Pps / (2.0f * M1_ACCEL);         // 從目前速度減到 0 要走的步數＝v²÷(2a)
  if (remain <= brake) m1Pps -= M1_ACCEL * 0.01f;          // 該減速了：每 10 ms 減少 a × 0.01 秒
  else if (m1Pps < M1_MAX_PPS) m1Pps += M1_ACCEL * 0.01f;  // 還沒到最高速：繼續加速
  if (m1Pps > M1_MAX_PPS) m1Pps = M1_MAX_PPS;
  if (m1Pps <= 0.0f || m1Pos >= M1_MOVE) {                 // 到了：停止、換方向、休息 0.5 秒
    M1_SetPps(0);
    m1Pps = 0.0f;
    m1Pos = 0.0f;
    m1Dir = !m1Dir;
    ${a.dir ? sdk.set('M1_DIR', 'm1Dir') : '// （CW 沒有接，方向不會改變）'}
    m1Wait = 50;
    return;
  }
  M1_SetPps((uint32_t)m1Pps);
  m1Pos += m1Pps * 0.01f;                                  // 這 10 ms 送出的步數
}`);
    loop.push('M1_Update();');
  }
  if (z){
    defs.push(`#define M2_MAX_PPS     (M2_STEPS_REV * 3)   // 最高速度：每秒 3 圈（180 RPM）`, `#define M2_ACCEL       (M2_STEPS_REV * 2)   // 加速度上限：每秒增加 2 圈／秒`);
    drivers.push(`// 速度慢慢靠近目標，每 10 ms 最多改變 a × 0.01 秒：這就是 ramp（斜坡）
float m2Pps = 0.0f;
float m2Target = M2_MAX_PPS / 3;

static void M2_Update(void)
{
  float step = M2_ACCEL * 0.01f;
  if (m2Pps < m2Target - step) m2Pps += step;
  else if (m2Pps > m2Target + step) m2Pps -= step;
  else m2Pps = m2Target;
  M2_SetPps((uint32_t)m2Pps);
}`);
    if (pot){
      const max = 2 ** b.adcBits - 1;
      loop.push('if (tick % 10 == 0) {                 // 每 100 ms：旋鈕決定 M2 的目標速度', ...sdk.adc(b).map(l => '  ' + l), `  m2Target = (float)adc * M2_MAX_PPS / ${max}.0f;`, '}');
    } else loop.push('if (tick % 300 == 0) m2Target = (m2Target > M2_MAX_PPS / 2) ? M2_MAX_PPS / 4 : M2_MAX_PPS;   // 每 3 秒切換快慢');
    loop.push('M2_Update();');
  }
  const line = info.map(x => `${x.nm}：%lu pps（%lu RPM）`).join('，');
  const args = info.map(x => `(unsigned long)${x.nm.toLowerCase()}Pps, (unsigned long)(${x.nm.toLowerCase()}Pps * 60.0f / ${x.nm}_STEPS_REV)`).join(', ');
  report.push(`${P}("${line}\\r\\n", ${args});`);
}

export function exampleCode(){
  const b = bench.board, sdk = sdkFor(b), mods = bench.modules, sug = suggestWiring(), P = sdk.print;
  const U8 = b.sdk === 'c2000' ? 'uint16_t' : 'uint8_t';
  const defs = [], cfg = [], drivers = [], init = [], blink = [], loop = [], report = [], slow = [], vars = ['uint32_t tick = 0;'], ports = new Set();
  const used = { i2c:mods.some(m => m.type === 'temp'), adc:mods.some(m => m.type === 'pot'), spi:!!b.spi && mods.some(m => SPI_TYPES.includes(m.type)), can:!!b.can && mods.some(m => m.type === 'can'), step:!!b.step && mods.some(m => m.type === 'stepper' || m.type === 'tb67') };
  const pre = [], spiDevs = [];
  const name = (m, base) => { const same = mods.filter(x => x.type === m.type); return same.length > 1 ? `${base}${same.indexOf(m) + 1}` : base; };
  const pinLabel = mcu => { const h = b.header.find(x => x.mcu === mcu); return h && h.label !== mcu ? `${h.label}（${mcu}）` : mcu; };
  const define = (nm, mcu, note, dir, pullUp) => {
    sdk.def(nm, mcu).forEach((l, i) => defs.push(i === 0 ? `${l}   // ${note}` : l));
    (dir === 'out' ? sdk.cfgOut(nm) : sdk.cfgIn(nm, pullUp)).forEach(l => cfg.push(l));
    const m = mcu.match(/^P([A-Q])\d+$/); if (m) ports.add(m[1]);
  };
  const setLed = (l, cond) => sdk.set(l.name, l.activeLow ? `!(${cond})` : cond);
  const tempLine = (label, expr, rh) => sdk.float
    ? [`${P}("${label} 溫度 = %.2f °C${rh ? '，溼度 = %.1f %%RH' : ''}\\r\\n", ${expr}${rh ? `, ${rh}` : ''});`]
    : [`int t100 = (int)(${expr} * 100.0f);`, `${P}("${label} 溫度 = %d.%02d °C${rh ? '，溼度 = %d %%RH' : ''}\\r\\n", t100 / 100, abs(t100 % 100)${rh ? `, (int)${rh}` : ''});`];

  b.leds.forEach(l => define(l.name, l.pin, `板載 ${l.name}${l.activeLow ? '（低電位點亮）' : ''}`, 'out'));
  if (b.btn) define(b.btn.name, b.btn.pin, `板載按鈕 ${b.btn.name}${b.btn.activeLow ? '（按下為低電位）' : ''}`, 'in', b.btn.activeLow);
  if (b.leds[0]) blink.push(sdk.tog(b.leds[0].name) + `   // 板載 ${b.leds[0].name}`);

  const keys = [], pirs = [], buzzers = [], sensors = [];
  let canParts = null;
  const stepInit = [];
  for (const m of mods){
    const v = variantOf(m.type, m.variant), label = `${moduleLabel(m)}（${v.part}）`, sig = n => signalMcu(m, n, sug);
    if (m.type === 'led' && sig('SIG')){ const nm = name(m, 'LED_EXT'); define(nm, sig('SIG'), `${label} SIG → ${pinLabel(sig('SIG'))}`, 'out'); blink.push(sdk.tog(nm)); }
    if (m.type === 'rgb' && sig('R') && sig('G') && sig('B')){
      const nm = name(m, 'RGB');
      for (const c of ['R', 'G', 'B']) define(`${nm}_${c}`, sig(c), `${label} ${c} → ${pinLabel(sig(c))}`, 'out');
      if (!vars.includes('uint32_t rgbStep = 0;')) vars.push('uint32_t rgbStep = 0;');
      blink.push('rgbStep = (rgbStep + 1) % 7;                // 紅、綠、黃、藍、紫、青、白',
        sdk.set(`${nm}_R`, '(rgbStep + 1) & 1'), sdk.set(`${nm}_G`, '(rgbStep + 1) & 2'), sdk.set(`${nm}_B`, '(rgbStep + 1) & 4'));
    }
    if (m.type === 'button' && sig('OUT')){ const nm = name(m, 'BTN'); define(nm, sig('OUT'), `${label} OUT → ${pinLabel(sig('OUT'))}`, 'in'); keys.push(nm); }
    if (m.type === 'pir' && sig('OUT')){ const nm = name(m, 'PIR'); define(nm, sig('OUT'), `${label} OUT → ${pinLabel(sig('OUT'))}`, 'in'); pirs.push(nm); }
    if (m.type === 'buzzer' && sig('SIG')){ const nm = name(m, 'BUZZER'); define(nm, sig('SIG'), `${label} SIG → ${pinLabel(sig('SIG'))}`, 'out'); buzzers.push(nm); }
    if (m.type === 'relay' && sig('IN')){ const nm = name(m, 'RELAY'); define(nm, sig('IN'), `${label} IN → ${pinLabel(sig('IN'))}`, 'out'); slow.push(sdk.tog(nm) + `   // ${moduleLabel(m)} 每 2 秒切換`); }
    if (m.type === 'pot'){
      const max = 2 ** b.adcBits - 1;
      report.push('{', ...sdk.adc(b).map(l => '  ' + l), sdk.float
        ? `  ${P}("${moduleLabel(m)} ADC = %4lu (%.2f V)\\r\\n", adc, adc * 3.3f / ${max}.0f);`
        : `  ${P}("${moduleLabel(m)} ADC = %4u（%u mV）\\r\\n", adc, (uint32_t)(adc * 3300 / ${max}));`, '}');
    }
    if (SPI_TYPES.includes(m.type) && used.spi){
      const s = name(m, m.type === 'tc' ? 'TC' : 'FLASH'), cs = sig('CS');
      if (cs){
        define(`${s}_CS`, cs, `${label} CS → ${pinLabel(cs)}（低電位選中）`, 'out');
        pre.push(sdk.pin(`${s}_CS`, 1) + `   // ${moduleLabel(m)} 先不選中`);
        drivers.push(spiDriver(v, s, `${s}_CS`, sdk, b, U8));
        spiDevs.push({ s, v, m });
      }
    }
    if (m.type === 'temp'){
      const s = name(m, 'TEMP');
      defs.push(`#define ${(s + '_ADDR').padEnd(14)} ${hex(v.addr)}   // ${label}，7 位元 I2C 位址`);
      drivers.push(driver(v, s, `${s}_ADDR`, sdk, b, U8));
      sensors.push({ s, v, m });
    }
  }
  for (const k of keys) loop.push(`int ${k.toLowerCase()} = ${sdk.read(k)};`);
  for (const p of pirs){ const l = p.toLowerCase(); vars.push(`int ${l}Last = 0;`); loop.push(`int ${l} = ${sdk.read(p)};`, `if (${l} && !${l}Last) ${P}("${p}：偵測到有人經過\\r\\n");`, `${l}Last = ${l};`); }
  const triggers = [...keys, ...pirs].map(k => k.toLowerCase());
  for (const z of buzzers) loop.push(triggers.length ? `${sdk.set(z, triggers.join(' || '))}   // 按下按鈕（或偵測到人）時響` : `${sdk.set(z, '(tick % 300) < 10')}   // 每 3 秒嗶一聲`);
  if (keys.length && !buzzers.length && b.leds[1]) loop.push(setLed(b.leds[1], keys[0].toLowerCase()) + `   // 外接按鈕 → ${b.leds[1].name}`);
  if (b.btn){
    const pressed = b.btn.activeLow ? `!${sdk.read(b.btn.name)}` : sdk.read(b.btn.name);
    if (b.leds.length >= 2){ const l = b.leds[b.leds.length - 1]; loop.push(setLed(l, pressed) + `   // 板載 ${b.btn.name} → ${l.name}`); }
    else { vars.push('int userLast = 0;'); loop.push(`int user = ${pressed};`, `if (user && !userLast) ${P}("${b.btn.name} 被按下\\r\\n");`, 'userLast = user;'); }
  }
  for (const { s, v, m } of spiDevs){
    if (v.dev === 'w25q'){
      init.push(`if (!${s}_Init()) ${P}("${moduleLabel(m)}（${v.part}）沒有回應，請檢查 SPI 接線\\r\\n");`);
      report.push('{', `  ${U8} d[8];`, `  ${s}_Read8(d);`, `  ${P}("${moduleLabel(m)} 位址 0x000000：%02X %02X %02X %02X %02X %02X %02X %02X（%c%c%c%c%c%c%c%c）\\r\\n", d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);`, '}');
    } else report.push('{', `  float t = ${s}_Read();`, '  if (t > -100.0f) {', ...tempLine(moduleLabel(m), 't', null).map(l => '    ' + l), `  } else ${P}("${moduleLabel(m)}：熱電偶沒有接好（斷線）\\r\\n");`, '}');
  }
  if (used.step) stepperCode(b, sdk, mods, sug, { defs, define, pre, drivers, loop, report, vars, stepInit, pinLabel, P, U8, b });
  if (used.can){
    const c = sdk.can(b);
    defs.push('#define CAN_TX_ID      0x123   // MCU 送出的訊框 ID', '#define CAN_RX_ID      0x200   // 收發器模組內建的測試節點送出的 ID');
    vars.push('uint16_t canCount = 0;');
    canParts = c;
    report.push('{', ...[c.set(0, '(canCount >> 8) & 0xFF'), c.set(1, 'canCount & 0xFF'), c.set(2, '0x00'), c.set(3, '0xFF')].map(l => '  ' + l), ...c.send.map(l => '  ' + l),
      `  ${P}("CAN 送出 ID 0x%03X：計數 %u\\r\\n", CAN_TX_ID, (unsigned)canCount);`, '  canCount++;', '}');
    loop.push(...c.rxPre, c.rxBegin, ...c.rxRead.map(l => '  ' + l),
      `  ${P}("CAN 收到 ID 0x%03X：%u 個位元組，計數 %u\\r\\n", (unsigned)(${c.rxId}), (unsigned)(${c.rxLen}), (unsigned)((${c.rxByte(0)} << 8) | ${c.rxByte(1)}));`, ...c.rxPost.map(l => '  ' + l), '}');
  }
  for (const { s, v, m } of sensors){
    init.push(`if (!${s}_Init()) ${P}("${moduleLabel(m)}（${v.part}）沒有回應，請檢查接線\\r\\n");`);
    const rh = v.dev === 'sht3x' || v.dev === 'aht20' ? `${s}_RH` : null;
    report.push('{', `  float t = ${s}_Read();`, '  if (t > -100.0f) {', ...tempLine(moduleLabel(m), 't', rh).map(l => '    ' + l), `  } else ${P}("${moduleLabel(m)} 讀取失敗\\r\\n");`, '}');
  }

  const ind = (arr, n) => arr.map(l => ' '.repeat(n) + l).join('\n');
  const i2cCode = used.i2c ? [sdk.i2c(b).replace(/uint8_t \*/g, `${U8} *`), `static int I2C_ReadReg(uint8_t addr, uint8_t reg, ${U8} *buf, int len)
{
  ${U8} r[1];
  r[0] = reg;
  if (!I2C_Write(addr, r, 1)) return 0;
  return I2C_Read(addr, buf, len);
}`] : [];
  const spiCode = used.spi && spiDevs.length ? sdk.spi(b) : null;
  if (spiCode) spiCode.helper = spiCode.helper.replace(/uint8_t \*/g, `${U8} *`);
  const globals = [...sdk.globals(b), ...(canParts ? canParts.globals : [])];
  return `/* main.c — 由模擬器依目前的開發板與模組產生
 * 晶片：${b.mcu}（${b.core}，${b.mhz} MHz）
 * 開發板：${b.name}
 * SDK：${sdk.name}；${P} 經由 ${b.vcp.periph} 輸出到虛擬序列埠（115200 bps）${used.spi ? `\n * SPI：${b.spi.bus}（SCK ${b.spi.sck}、MISO ${b.spi.miso}、MOSI ${b.spi.mosi}）` : ''}${used.can ? `\n * CAN：${b.can.bus}（TX ${b.can.tx}、RX ${b.can.rx}），500 kbps` : ''}${used.step ? `\n * 步進馬達：TB67S128FTG（CLK-IN 模式），STEP 由計時器 PWM 產生，每 10 ms 更新一次頻率（梯形加減速）` : ''}
 */
${sdk.includes(b, used).join('\n')}

${defs.join('\n')}
${globals.length ? '\n' + globals.join('\n') + '\n' : ''}${i2cCode.length ? '\n' + i2cCode.join('\n\n') + '\n' : ''}${spiCode ? '\n' + spiCode.helper + '\n' : ''}${drivers.length ? '\n' + drivers.join('\n\n') + '\n' : ''}
int main(void)
{
${ind([...sdk.init(b, used, ports), ...(spiCode ? spiCode.init : []), ...(canParts ? canParts.init : []), ...stepInit], 2)}
${cfg.length ? ind(cfg, 2) + '\n' : ''}${pre.length ? ind(pre, 2) + '\n' : ''}
  ${P}("\\r\\n${b.name} 啟動\\r\\n");
${init.length ? ind(init, 2) + '\n' : ''}
${ind(vars, 2)}
  while (1)
  {
    tick++;
    if (tick % 50 == 0) {                 // 每 500 ms
${ind(blink.length ? blink : ['// 沒有可閃爍的 LED'], 6)}
    }
${loop.length ? '\n' + ind(loop, 4) + '\n' : ''}
    if (tick % 100 == 0) {                // 每秒回報一次
${ind(report.length ? report : [`${P}("運作中，第 %u 秒\\r\\n", tick / 100);`], 6)}
    }
${slow.length ? `\n    if (tick % 200 == 0) {\n${ind(slow, 6)}\n    }\n` : ''}
    ${sdk.delay(10, b)}
  }
}
`;
}
