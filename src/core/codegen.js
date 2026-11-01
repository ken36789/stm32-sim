// 依目前的開發板與模組產生「建議接線」與「範例 main.c」
import { MODULE_TYPES, variantOf } from './parts.js';
import { bench, netInfo, moduleLabel } from './sim.js';

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

/* ---------- 範例程式 ---------- */
const port = mcu => `GPIO${mcu[1]}`, pin = mcu => `GPIO_PIN_${mcu.slice(2)}`;
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

/** 找出模組某支腳實際（或建議）接到的 MCU 腳位 */
function signalMcu(m, n, suggested){
  const g = netInfo(`${m.id}.${n}`).gpio[0];
  if (g) return g;
  const pair = suggested.find(([a, c]) => c === `${m.id}.${n}`);
  return pair ? bench.board.header.find(h => h.id === pair[0])?.mcu : null;
}

function driver(v, s, A){
  const I2C = `&hi2c1, ${A}`;
  switch (v.dev){
    case 'bmx280': return `static uint16_t ${s}_T1;
static int16_t ${s}_T2;
static int16_t ${s}_T3;

static int ${s}_Init(void)
{
  uint8_t id[1];
  uint8_t c[6];
  uint8_t mode[1] = {0x27};          // 溫度、氣壓各取樣 1 次，正常模式
  if (HAL_I2C_Mem_Read(${I2C}, 0xD0, I2C_MEMADD_SIZE_8BIT, id, 1, 100) != HAL_OK) return 0;
  printf("${v.part} 晶片 ID = 0x%02X\\r\\n", id[0]);
  HAL_I2C_Mem_Write(${I2C}, 0xF4, I2C_MEMADD_SIZE_8BIT, mode, 1, 100);
  HAL_I2C_Mem_Read(${I2C}, 0x88, I2C_MEMADD_SIZE_8BIT, c, 6, 100);   // 校正值 dig_T1..T3
  ${s}_T1 = c[0] | (c[1] << 8);
  ${s}_T2 = (int16_t)(c[2] | (c[3] << 8));
  ${s}_T3 = (int16_t)(c[4] | (c[5] << 8));
  return 1;
}

// datasheet 第 3.11.3 節的 32 位元整數補償公式
static float ${s}_Read(void)
{
  uint8_t d[3];
  if (HAL_I2C_Mem_Read(${I2C}, 0xFA, I2C_MEMADD_SIZE_8BIT, d, 3, 100) != HAL_OK) return -999.0f;
  int32_t adc = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
  int32_t var1 = (((adc >> 3) - ((int32_t)${s}_T1 << 1)) * ((int32_t)${s}_T2)) >> 11;
  int32_t var2 = (((((adc >> 4) - ((int32_t)${s}_T1)) * ((adc >> 4) - ((int32_t)${s}_T1))) >> 12) * ((int32_t)${s}_T3)) >> 14;
  return (((var1 + var2) * 5 + 128) >> 8) / 100.0f;
}`;
    case 'lm75':
    case 'tmp102': {
      const shift = v.dev === 'lm75' ? 5 : 4, lsb = v.dev === 'lm75' ? '0.125f' : '0.0625f';
      return `static int ${s}_Init(void)
{
  return HAL_I2C_IsDeviceReady(${I2C}, 3, 100) == HAL_OK;
}

static float ${s}_Read(void)
{
  uint8_t d[2];
  if (HAL_I2C_Mem_Read(${I2C}, 0x00, I2C_MEMADD_SIZE_8BIT, d, 2, 100) != HAL_OK) return -999.0f;
  int16_t raw = (int16_t)((d[0] << 8) | d[1]) >> ${shift};   // ${v.dev === 'lm75' ? '11' : '12'} 位元，左對齊
  return raw * ${lsb};
}`;
    }
    case 'mcp9808': return `static int ${s}_Init(void)
{
  uint8_t id[2];
  if (HAL_I2C_Mem_Read(${I2C}, 0x06, I2C_MEMADD_SIZE_8BIT, id, 2, 100) != HAL_OK) return 0;
  printf("MCP9808 製造商 ID = 0x%02X%02X\\r\\n", id[0], id[1]);
  return 1;
}

static float ${s}_Read(void)
{
  uint8_t d[2];
  if (HAL_I2C_Mem_Read(${I2C}, 0x05, I2C_MEMADD_SIZE_8BIT, d, 2, 100) != HAL_OK) return -999.0f;
  int16_t raw = (int16_t)(((d[0] & 0x1F) << 8) | d[1]);
  if (raw & 0x1000) raw -= 0x2000;                  // 負溫度
  return raw * 0.0625f;
}`;
    case 'hdc1080': return `static int ${s}_Init(void)
{
  uint8_t id[2];
  if (HAL_I2C_Mem_Read(${I2C}, 0xFF, I2C_MEMADD_SIZE_8BIT, id, 2, 100) != HAL_OK) return 0;
  printf("HDC1080 裝置 ID = 0x%02X%02X\\r\\n", id[0], id[1]);
  return 1;
}

static float ${s}_Read(void)
{
  uint8_t cmd[1] = {0x00};
  uint8_t d[2];
  if (HAL_I2C_Master_Transmit(${I2C}, cmd, 1, 100) != HAL_OK) return -999.0f;
  HAL_Delay(10);                                    // 轉換時間約 6.35 ms
  if (HAL_I2C_Master_Receive(${I2C}, d, 2, 100) != HAL_OK) return -999.0f;
  return ((d[0] << 8) | d[1]) * 165.0f / 65536.0f - 40.0f;
}`;
    case 'sht3x': return `static float ${s}_RH;

static int ${s}_Init(void)
{
  return HAL_I2C_IsDeviceReady(${I2C}, 3, 100) == HAL_OK;
}

static float ${s}_Read(void)
{
  uint8_t cmd[2] = {0x24, 0x00};                    // 單次量測、高重複性
  uint8_t d[6];
  if (HAL_I2C_Master_Transmit(${I2C}, cmd, 2, 100) != HAL_OK) return -999.0f;
  HAL_Delay(20);
  if (HAL_I2C_Master_Receive(${I2C}, d, 6, 100) != HAL_OK) return -999.0f;
  ${s}_RH = 100.0f * ((d[3] << 8) | d[4]) / 65535.0f;
  return -45.0f + 175.0f * ((d[0] << 8) | d[1]) / 65535.0f;
}`;
    case 'aht20': return `static float ${s}_RH;

static int ${s}_Init(void)
{
  uint8_t init[3] = {0xBE, 0x08, 0x00};
  HAL_Delay(40);
  return HAL_I2C_Master_Transmit(${I2C}, init, 3, 100) == HAL_OK;
}

static float ${s}_Read(void)
{
  uint8_t cmd[3] = {0xAC, 0x33, 0x00};              // 觸發量測
  uint8_t d[7];
  if (HAL_I2C_Master_Transmit(${I2C}, cmd, 3, 100) != HAL_OK) return -999.0f;
  HAL_Delay(80);
  if (HAL_I2C_Master_Receive(${I2C}, d, 7, 100) != HAL_OK || (d[0] & 0x80)) return -999.0f;
  uint32_t rh = (d[1] << 12) | (d[2] << 4) | (d[3] >> 4);
  uint32_t t = ((d[3] & 0x0F) << 16) | (d[4] << 8) | d[5];
  ${s}_RH = rh * 100.0f / 1048576.0f;
  return t * 200.0f / 1048576.0f - 50.0f;
}`;
  }
  return '';
}

export function exampleCode(){
  const b = bench.board, mods = bench.modules, sug = suggestWiring();
  const defs = [], drivers = [], init = [], blink = [], loop = [], report = [], slow = [];
  const name = (m, base) => { const same = mods.filter(x => x.type === m.type); return same.length > 1 ? `${base}${same.indexOf(m) + 1}` : base; };
  const define = (nm, mcu, note) => { defs.push(`#define ${(nm + '_Port').padEnd(14)} ${port(mcu).padEnd(7)}  // ${note}`, `#define ${(nm + '_Pin').padEnd(14)} ${pin(mcu)}`); };
  const pinLabel = mcu => { const h = b.header.find(x => x.mcu === mcu); return h && h.label !== mcu ? `${h.label}（${mcu}）` : mcu; };

  b.leds.forEach((l, i) => define(l.name, l.pin, `板載 ${l.name}${l.activeLow ? '（低電位點亮）' : ''}`));
  if (b.btn) define(b.btn.name, b.btn.pin, `板載按鈕 ${b.btn.name}${b.btn.activeLow ? '（按下為低電位）' : ''}`);
  if (b.leds[0]) blink.push(`HAL_GPIO_TogglePin(${b.leds[0].name}_Port, ${b.leds[0].name}_Pin);`);

  const keys = [], pirs = [], buzzers = [], sensors = [];
  for (const m of mods){
    const v = variantOf(m.type, m.variant), label = `${moduleLabel(m)}（${v.part}）`;
    const sig = n => signalMcu(m, n, sug);
    if (m.type === 'led' && sig('SIG')){ const nm = name(m, 'LED_EXT'); define(nm, sig('SIG'), `${label} SIG → ${pinLabel(sig('SIG'))}`); blink.push(`HAL_GPIO_TogglePin(${nm}_Port, ${nm}_Pin);`); }
    if (m.type === 'rgb' && sig('R') && sig('G') && sig('B')){
      const nm = name(m, 'RGB');
      for (const c of ['R', 'G', 'B']) define(`${nm}_${c}`, sig(c), `${label} ${c} → ${pinLabel(sig(c))}`);
      blink.push(`rgbStep = (rgbStep + 1) % 7;                // 紅、綠、黃、藍、紫、青、白`,
        `HAL_GPIO_WritePin(${nm}_R_Port, ${nm}_R_Pin, ((rgbStep + 1) & 1) ? GPIO_PIN_SET : GPIO_PIN_RESET);`,
        `HAL_GPIO_WritePin(${nm}_G_Port, ${nm}_G_Pin, ((rgbStep + 1) & 2) ? GPIO_PIN_SET : GPIO_PIN_RESET);`,
        `HAL_GPIO_WritePin(${nm}_B_Port, ${nm}_B_Pin, ((rgbStep + 1) & 4) ? GPIO_PIN_SET : GPIO_PIN_RESET);`);
    }
    if (m.type === 'button' && sig('OUT')){ const nm = name(m, 'BTN'); define(nm, sig('OUT'), `${label} OUT → ${pinLabel(sig('OUT'))}`); keys.push(nm); }
    if (m.type === 'pir' && sig('OUT')){ const nm = name(m, 'PIR'); define(nm, sig('OUT'), `${label} OUT → ${pinLabel(sig('OUT'))}`); pirs.push(nm); }
    if (m.type === 'buzzer' && sig('SIG')){ const nm = name(m, 'BUZZER'); define(nm, sig('SIG'), `${label} SIG → ${pinLabel(sig('SIG'))}`); buzzers.push(nm); }
    if (m.type === 'relay' && sig('IN')){ const nm = name(m, 'RELAY'); define(nm, sig('IN'), `${label} IN → ${pinLabel(sig('IN'))}`); slow.push(`HAL_GPIO_TogglePin(${nm}_Port, ${nm}_Pin);    // ${moduleLabel(m)} 每 2 秒切換`); }
    if (m.type === 'pot'){
      report.push(`HAL_ADC_Start(&hadc1);`, `if (HAL_ADC_PollForConversion(&hadc1, 10) == HAL_OK) {`, `  uint32_t adc = HAL_ADC_GetValue(&hadc1);`,
        `  printf("${moduleLabel(m)} ADC = %4lu (%.2f V)\\r\\n", adc, adc * 3.3f / 4095.0f);`, `}`);
    }
    if (m.type === 'temp'){
      const s = name(m, 'TEMP');
      defs.push(`#define ${(s + '_ADDR').padEnd(14)} (${hex(v.addr)} << 1)  // ${label}，7 位元位址 ${hex(v.addr)}`);
      drivers.push(driver(v, s, `${s}_ADDR`));
      sensors.push({ s, v, m });
    }
  }
  for (const k of keys) loop.push(`GPIO_PinState ${k.toLowerCase()} = HAL_GPIO_ReadPin(${k}_Port, ${k}_Pin);`);
  for (const p of pirs) loop.push(`GPIO_PinState ${p.toLowerCase()} = HAL_GPIO_ReadPin(${p}_Port, ${p}_Pin);`,
    `if (${p.toLowerCase()} == GPIO_PIN_SET && !${p.toLowerCase()}Last) printf("${p}：偵測到有人經過\\r\\n");`, `${p.toLowerCase()}Last = ${p.toLowerCase()};`);
  const triggers = [...keys, ...pirs].map(k => `${k.toLowerCase()} == GPIO_PIN_SET`);
  for (const z of buzzers) loop.push(triggers.length ? `HAL_GPIO_WritePin(${z}_Port, ${z}_Pin, (${triggers.join(' || ')}) ? GPIO_PIN_SET : GPIO_PIN_RESET);` : `HAL_GPIO_WritePin(${z}_Port, ${z}_Pin, (now % 3000) < 100 ? GPIO_PIN_SET : GPIO_PIN_RESET);   // 每 3 秒嗶一聲`);
  if (keys.length && !buzzers.length && b.leds[1]){ const l = b.leds[1]; loop.push(`HAL_GPIO_WritePin(${l.name}_Port, ${l.name}_Pin, (${keys[0].toLowerCase()} == GPIO_PIN_SET) ${l.activeLow ? '? GPIO_PIN_RESET : GPIO_PIN_SET' : '? GPIO_PIN_SET : GPIO_PIN_RESET'});   // 外接按鈕 → ${l.name}`); }
  if (b.btn){
    const l = b.leds[b.leds.length - 1], pressed = `HAL_GPIO_ReadPin(${b.btn.name}_Port, ${b.btn.name}_Pin) == ${b.btn.activeLow ? 'GPIO_PIN_RESET' : 'GPIO_PIN_SET'}`;
    if (b.leds.length >= 2) loop.push(`HAL_GPIO_WritePin(${l.name}_Port, ${l.name}_Pin, (${pressed}) ${l.activeLow ? '? GPIO_PIN_RESET : GPIO_PIN_SET' : '? GPIO_PIN_SET : GPIO_PIN_RESET'});   // 板載 ${b.btn.name} → ${l.name}`);
    else loop.push(`if ((${pressed}) && !userLast) printf("${b.btn.name} 被按下\\r\\n");`, `userLast = (${pressed});`);
  }
  for (const { s, v, m } of sensors){
    init.push(`if (!${s}_Init()) printf("${moduleLabel(m)}（${v.part}）沒有回應，請檢查接線\\r\\n");`);
    const rh = v.dev === 'sht3x' || v.dev === 'aht20';
    report.push(`float ${s.toLowerCase()} = ${s}_Read();`,
      `if (${s.toLowerCase()} > -100.0f) printf("${moduleLabel(m)} 溫度 = %.2f °C${rh ? '，溼度 = %.1f %%RH' : ''}\\r\\n", ${s.toLowerCase()}${rh ? `, ${s}_RH` : ''});`,
      `else printf("${moduleLabel(m)} 讀取失敗\\r\\n");`);
  }

  const ind = (arr, n) => arr.map(l => ' '.repeat(n) + l).join('\n');
  const vars = ['uint32_t tBlink = 0, tReport = 0, tSlow = 0;'];
  if (blink.some(l => l.includes('rgbStep'))) vars.push('uint8_t rgbStep = 0;');
  for (const p of pirs) vars.push(`GPIO_PinState ${p.toLowerCase()}Last = GPIO_PIN_RESET;`);
  if (b.btn && b.leds.length < 2) vars.push('int userLast = 0;');
  return `/* main.c — 由模擬器依目前的開發板與模組產生
 * 開發板：${b.name}（${b.mcu}，${b.core} ${b.mhz} MHz）
 * printf 經由 ${b.vcp.periph}${b.form === 'pill' ? '（PA9 → USB 轉 TTL）' : '（ST-LINK 虛擬 COM）'}輸出，115200 bps
 */
#include "main.h"
#include <stdio.h>

${defs.join('\n')}
${drivers.length ? '\n' + drivers.join('\n\n') + '\n' : ''}
int main(void)
{
  HAL_Init();
  SystemClock_Config();            // SYSCLK ${b.mhz} MHz
  MX_GPIO_Init();
${sensors.length ? `  MX_I2C1_Init();                  // ${b.i2c.bus}：SCL ${pinLabel(b.header.find(h => h.label === b.i2c.scl).mcu)}、SDA ${pinLabel(b.header.find(h => h.label === b.i2c.sda).mcu)}\n` : ''}${mods.some(m => m.type === 'pot') ? '  MX_ADC1_Init();\n' : ''}  MX_${b.vcp.periph}_UART_Init();

  printf("\\r\\n${b.name} 啟動\\r\\n");
${ind(init, 2)}

${ind(vars, 2)}
  while (1)
  {
    uint32_t now = HAL_GetTick();

    if (now - tBlink >= 500) {             // 每 500 ms
      tBlink = now;
${ind(blink, 6)}
    }
${loop.length ? '\n' + ind(loop, 4) + '\n' : ''}
    if (now - tReport >= 1000) {           // 每秒回報一次
      tReport = now;
${ind(report.length ? report : ['printf("運作中，時間 %lu ms\\r\\n", now);'], 6)}
    }
${slow.length ? `\n    if (now - tSlow >= 2000) {\n      tSlow = now;\n${ind(slow, 6)}\n    }\n` : ''}
    HAL_Delay(10);
  }
}
`;
}
