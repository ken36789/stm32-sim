// 模擬核心測試（不需要瀏覽器）：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS } from '../src/core/boards.js';
import { MODULE_TYPES, TYPE_ORDER, DEFAULT_MODULES } from '../src/core/parts.js';
import { hooks } from '../src/core/hooks.js';
import { SIM, bench, setBoard, addModule, resetBench, addWire, refreshNet, readPin, moduleState, i2cDevices, setVariant } from '../src/core/sim.js';
import { runChecks } from '../src/core/checks.js';
import { compile } from '../src/core/compiler.js';
import { cfmt } from '../src/core/printf.js';
import { startProgram, stopProgram } from '../src/core/runtime.js';
import { suggestWiring, exampleCode } from '../src/core/codegen.js';
import { bmxCompensate, crc8 } from '../src/core/devices.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = res => res.filter(r => r.sev === 'err' || r.sev === 'warn').map(r => `${r.sev}: ${r.title}`);
function setup(boardId, mods = DEFAULT_MODULES){
  resetBench(); setBoard(boardId, true);
  mods.forEach(m => addModule(m.type, m.variant, true));
  suggestWiring().forEach(([a, b]) => assert.ok(addWire(a, b, null, true), `接線失敗 ${a} → ${b}`));
  refreshNet();
}
// 等到條件成立（或逾時）。用輪詢而不是固定等待，機器忙碌時測試也不會誤判。
async function until(cond, ms = 4000){
  const t0 = Date.now();
  while (!cond()){ if (Date.now() - t0 > ms) return false; await sleep(10); }
  return true;
}
// 燒錄範例程式並執行，直到序列埠輸出符合 want 的所有規則（最多等 max 毫秒）。
async function run(want, during, max = 6000){
  let out = ''; hooks.serial = s => { out += s; };
  const c = compile(exampleCode()); assert.equal(c.ok, true, JSON.stringify(c.diag));
  SIM.flashed = { js:c.js, size:c.size.text }; startProgram();
  if (during) await during();
  await until(() => want.every(r => r.test(out)), max); stopProgram(true);
  return out;
}

test('ST、TI、NXP 各至少 30 種晶片，排針資料完整', () => {
  for (const v of ["ST", "TI", "NXP"]) assert.ok(BOARDS.filter(b => b.vendor === v).length >= 30, v);
  for (const b of BOARDS){
    assert.ok(b.header.length >= 20, b.id);
    assert.ok(b.header.find(h => h.label === b.i2c.scl) && b.header.find(h => h.label === b.i2c.sda), `${b.id} 缺少 I2C 腳`);
    assert.ok(b.header.some(h => h.tags.includes('adc')), `${b.id} 沒有 ADC 腳`);
    assert.equal(new Set(b.header.filter(h => h.mcu).map(h => h.mcu)).size, b.header.filter(h => h.mcu).length, `${b.id} 有重複的 MCU 腳位`);
  }
});

test('全部 116 種晶片：建議接線 + 範例程式可以編譯（無警告），檢測沒有錯誤或警告', () => {
  for (const b of BOARDS){
    setup(b.id);
    const c = compile(exampleCode());
    assert.equal(c.ok, true, `${b.id}: ${JSON.stringify(c.diag)}`);
    assert.deepEqual(c.diag, [], b.id);
    assert.deepEqual(problems(runChecks(exampleCode())), [], b.id);
  }
});

test('所有模組同時接上（8 個）也能自動接線並通過檢測', () => {
  const all = TYPE_ORDER.map(t => ({ type:t, variant:t === 'pir' ? 'pir-am312' : t === 'relay' ? 'relay-3v' : undefined }));
  for (const id of ['nucleo-f401re', 'nucleo-l432kc', 'bluepill-f103c8', 'stm32f407g-disc1', 'nucleo-h743zi2']){
    setup(id, all);
    assert.equal(bench.modules.length, 8);
    assert.deepEqual(problems(runChecks(exampleCode())), [], id);
    assert.equal(compile(exampleCode()).ok, true, id);
  }
});

test('每一種溫度感測器型號都能讀到合理溫度', async () => {
  for (const v of MODULE_TYPES.temp.variants){
    setup('nucleo-f411re', [{ type:'temp', variant:v.id }]);
    const out = await run([/溫度 = /]);
    const t = out.match(/溫度 = (-?\d+\.\d+)/);
    assert.ok(t, `${v.id} 沒有讀到溫度：${out}`);
    assert.ok(Math.abs(+t[1] - SIM.ambient.T) < 3, `${v.id} 溫度 ${t[1]}`);
  }
});

test('兩顆 0x48 感測器會被判定為位址衝突', () => {
  setup('nucleo-f401re', [{ type:'temp', variant:'tmp102' }, { type:'temp', variant:'lm75a' }]);
  assert.ok(problems(runChecks(exampleCode())).some(p => /位址衝突/.test(p)));
  assert.equal(i2cDevices().length, 2);
});

test('接錯的狀況：5V 感測器、HC-SR501 接 3V3、電位器接到非 ADC 腳', () => {
  setup('nucleo-f401re', [{ type:'temp', variant:'bme280' }]);
  resetBench(); setBoard('nucleo-f401re', true); addModule('temp', 'bme280', true); addModule('pir', 'pir-sr501', true); addModule('pot', 'pot-rotary', true);
  [['J.5V~1', 'M1.VCC'], ['J.GND~1', 'M1.GND'], ['J.D15', 'M1.SCL'], ['J.D14', 'M1.SDA'], ['J.3V3~1', 'M2.VCC'], ['J.GND~2', 'M2.GND'], ['J.D2', 'M2.OUT'], ['J.3V3~2', 'M3.VCC'], ['J.GND~3', 'M3.GND'], ['J.D7', 'M3.OUT']]
    .forEach(([a, b]) => addWire(a, b, null, true));
  refreshNet();
  const errs = runChecks(exampleCode()).filter(r => r.sev === 'err').map(r => r.title).join('\n');
  assert.match(errs, /VCC 接到 5 V/);
  assert.match(errs, /VCC 只有 3.3 V/);
  assert.match(errs, /OUT 接到 D7/);
});

test('程式執行：按鈕、ADC、板載 LED', async () => {
  setup('nucleo-f401re', [{ type:'button' }, { type:'pot' }, { type:'buzzer' }]);
  const btn = bench.modules[0], buz = bench.modules[2];
  bench.modules[1].st.pot = .5;
  const out = await run([/ADC = /], async () => { await sleep(200); btn.st.pressed = true; assert.ok(await until(() => moduleState(buz).on), '按下按鈕時蜂鳴器沒有響'); });
  assert.match(out, /ADC = +\d+ \(1\.6\d V\)/);
  assert.equal(readPin('PA10'), 1);
  btn.st.pressed = false;
});

test('Black Pill 的 KEY 按鈕是低電位有效', () => {
  setup('blackpill-f411ce', []);
  assert.equal(readPin('PA0'), 1); SIM.b1 = true; assert.equal(readPin('PA0'), 0); SIM.b1 = false;
});

test('更換型號後仍保留接線', () => {
  setup('nucleo-g431rb');
  const n = bench.modules.length, w = suggestWiring().length;
  setVariant(bench.modules[2].id, 'sht31');
  assert.equal(bench.modules.length, n); assert.ok(w > 0);
  assert.deepEqual(problems(runChecks(exampleCode())), []);
});

test('BMP280 補償公式與 CRC-8', () => {
  assert.equal(bmxCompensate(519888), 2508);      // datasheet 範例：25.08 °C
  assert.equal(crc8([0xBE, 0xEF]), 0x92);           // Sensirion datasheet 範例
});

test('printf 格式化', () => {
  assert.equal(cfmt('%05.1f|%-4d|%02X|%s|%%', [3.14159, 7, 10, 'ok']), '003.1|7   |0A|ok|%');
  assert.equal(cfmt('%4lu', [42]), '  42');
});

test('編譯錯誤：缺少分號、不存在的腳位、不支援的函式', () => {
  setup('nucleo-f401re');
  const src = exampleCode().replace('HAL_Delay(10);', 'HAL_Delay(10)').replace('GPIO_PIN_5', 'GPIO_PIN_16') + '\nvoid f(void){ HAL_SPI_Transmit(0); }\n';
  const msgs = compile(src).diag.map(d => d.msg).join('\n');
  assert.match(msgs, /expected ';' before '}'/);
  assert.match(msgs, /'GPIO_PIN_16' undeclared/);
  assert.match(msgs, /implicit declaration of function 'HAL_SPI_Transmit'/);
});

test('每一種 SDK 的範例程式都能執行：GPIO、按鈕→蜂鳴器、I2C 感測器、ADC', async () => {
  const cases = { 'nucleo-f401re':'STM32 HAL', mspm0g3507:'MSPM0', msp430fr2355:'MSP430 eUSCI', msp430f5529:'MSP430 USCI', tm4c123gh6pm:'TivaWare', tms320f28379d:'C2000',
    mk64fn1m0vll12:'Kinetis', lpc55s69jbd100:'LPC55', lpc845m301jbd48:'LPC800', mimxrt1062dvl6b:'i.MX RT', mcxn947vdf:'MCX' };
  for (const [id, label] of Object.entries(cases)){
    setup(id, [{ type:'led' }, { type:'button' }, { type:'temp', variant:'sht31' }, { type:'pot' }, { type:'buzzer' }]);
    const btn = bench.modules[1], buz = bench.modules[4];
    bench.modules[3].st.pot = .25;
    let buzzing = false;
    const out = await run([/溫度 = /, /ADC = /], async () => { await sleep(250); btn.st.pressed = true; buzzing = await until(() => moduleState(buz).on); });
    btn.st.pressed = false;
    assert.ok(buzzing, `${label}：按下按鈕時蜂鳴器沒有響`);
    assert.match(out, /溫度 = \d+\.\d\d °C/, `${label}：${out}`);
    assert.match(out, /ADC = +\d+/, `${label}：${out}`);
    assert.ok(Object.values(SIM.mode).includes('out'), `${label}：沒有任何 GPIO 輸出`);
  }
});

test('TI／NXP 程式沒有控制 LED 所接的腳位時，檢測會警告', () => {
  for (const id of ['msp430fr2355', 'mk64fn1m0vll12', 'tms320f28379d']){
    setup(id, [{ type:'led' }]);
    const code = exampleCode().replace(/#define LED_EXT_\w+[^\n]*\n/g, m => m.replace(/(P\d\.|PT[A-E]|GPIO_PIN|PIN\s+)(\d+)/, (x, a, n) => a + (+n + 1)));
    const warns = runChecks(code).filter(r => r.sev === 'warn').map(r => r.title).join('\n');
    assert.match(warns, /程式沒有控制/, id);
  }
});

test('不支援的 SDK 設定函式只會警告並略過，不會讓編譯失敗', () => {
  setup('mspm0g3507', []);
  const c = compile(exampleCode().replace('SYSCFG_DL_init();', 'SYSCFG_DL_init();\n  DL_TimerG_startCounter(TIMER_0_INST);'));
  assert.equal(c.ok, true);
  assert.match(c.diag.map(d => d.msg).join(), /DL_TimerG_startCounter.*略過/);
});
