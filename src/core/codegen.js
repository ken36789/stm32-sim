// 依目前的開發板與模組產生「建議接線」與「範例 main.c」
import { MODULE_TYPES, variantOf } from './parts.js';
import { bench, netInfo, moduleLabel } from './sim.js';
import { sdkFor } from './sdk.js';

const SIGNAL = { led:['SIG'], rgb:['R', 'G', 'B'], button:['OUT'], pir:['OUT'], buzzer:['SIG'], relay:['IN'], pot:['OUT'] };

/** 建議接線：回傳 [[腳位, 腳位], …]。電源經由電源軌分配，I2C 感測器以串接方式共用匯流排。 */
export function suggestWiring(){
  const b = bench.board, H = b.header, pairs = [], used = new Set();
  const id = label => H.find(h => h.label === label && !used.has(h.id))?.id;
  const take = label => { const x = id(label); if (x) used.add(x); return x; };
  const p3 = take('3V3'), g = take('GND');
  pairs.push([p3, 'R.+1'], [g, 'R.-1']);
  let plus = 2, minus = 2;
  const rail = s => s === '+' ? `R.+${plus++}` : `R.-${minus++}`;
  const avoid = h => h.kind !== 'gpio' || ['scl', 'sda', 'vcp', 'led'].some(t => h.tags.includes(t)) || (b.btn && h.mcu === b.btn.pin);
  const rank = h => /^D([2-9]|1[0-2])$/.test(h.label) ? 0 : /^D/.test(h.label) ? 2 : 1;
  const digital = H.filter(h => !avoid(h) && !h.tags.includes('adc')).sort((x, y) => rank(x) - rank(y));
  const analog = H.filter(h => !avoid(h) && h.tags.includes('adc'));
  const nextPin = list => { const h = list.find(x => !used.has(x.id)); if (h) used.add(h.id); return h?.id; };
  let firstI2C = null;
  for (const m of bench.modules){
    const v = variantOf(m.type, m.variant), P = n => `${m.id}.${n}`;
    const pins = MODULE_TYPES[m.type].pins.map(p => p[0]);
    if (pins.includes('VCC')) pairs.push([v.vmin > 3.6 ? (take('5V') || rail('+')) : rail('+'), P('VCC')]);
    if (pins.includes('GND')) pairs.push([rail('-'), P('GND')]);
    if (m.type === 'temp'){
      if (!firstI2C){ pairs.push([take(b.i2c.scl), P('SCL')], [take(b.i2c.sda), P('SDA')]); firstI2C = m; }
      else pairs.push([`${firstI2C.id}.SCL`, P('SCL')], [`${firstI2C.id}.SDA`, P('SDA')]);
      continue;
    }
    for (const n of SIGNAL[m.type] || []){ const h = nextPin(m.type === 'pot' ? analog : digital); if (h) pairs.push([h, P(n)]); }
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

export function exampleCode(){
  const b = bench.board, sdk = sdkFor(b), mods = bench.modules, sug = suggestWiring(), P = sdk.print;
  const U8 = b.sdk === 'c2000' ? 'uint16_t' : 'uint8_t';
  const defs = [], cfg = [], drivers = [], init = [], blink = [], loop = [], report = [], slow = [], vars = ['uint32_t tick = 0;'], ports = new Set();
  const used = { i2c:mods.some(m => m.type === 'temp'), adc:mods.some(m => m.type === 'pot') };
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
  const globals = sdk.globals(b);
  return `/* main.c — 由模擬器依目前的開發板與模組產生
 * 晶片：${b.mcu}（${b.core}，${b.mhz} MHz）
 * 開發板：${b.name}
 * SDK：${sdk.name}；${P} 經由 ${b.vcp.periph} 輸出到虛擬序列埠（115200 bps）
 */
${sdk.includes(b).join('\n')}

${defs.join('\n')}
${globals.length ? '\n' + globals.join('\n') + '\n' : ''}${i2cCode.length ? '\n' + i2cCode.join('\n\n') + '\n' : ''}${drivers.length ? '\n' + drivers.join('\n\n') + '\n' : ''}
int main(void)
{
${ind(sdk.init(b, used, ports), 2)}
${cfg.length ? ind(cfg, 2) + '\n' : ''}
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
