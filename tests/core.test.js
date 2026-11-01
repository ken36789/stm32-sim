// 模擬核心測試（不需要瀏覽器）：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE, FULL } from '../src/core/board.js';
import { hooks } from '../src/core/hooks.js';
import { SIM, addWire, clearWires, refreshNet, ledOn, readPin } from '../src/core/sim.js';
import { runChecks } from '../src/core/checks.js';
import { compile } from '../src/core/compiler.js';
import { cfmt } from '../src/core/printf.js';
import { startProgram, stopProgram } from '../src/core/runtime.js';
import { DEFAULT_CODE } from '../src/core/default-code.js';

const load = list => { clearWires(true); list.forEach(([a, b]) => addWire(a, b, null, true)); refreshNet(); };
const errors = res => res.filter(r => r.sev === 'err').map(r => r.title);
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('預設 main.c 可以編譯', () => {
  const r = compile(DEFAULT_CODE);
  assert.equal(r.ok, true, JSON.stringify(r.diag));
  assert.ok(r.size.text > 10000);
});

test('編譯錯誤：缺少分號、不存在的腳位、不支援的函式', () => {
  const src = DEFAULT_CODE.replace('HAL_Delay(10);', 'HAL_Delay(10)').replace('GPIOA, GPIO_PIN_5)', 'GPIOA, GPIO_PIN_16)') + '\nvoid f(void){ HAL_SPI_Transmit(0); }\n';
  const r = compile(src);
  assert.equal(r.ok, false);
  const msgs = r.diag.map(d => d.msg).join('\n');
  assert.match(msgs, /expected ';' before '}'/);
  assert.match(msgs, /'GPIO_PIN_16' undeclared/);
  assert.match(msgs, /implicit declaration of function 'HAL_SPI_Transmit'/);
});

test('範例接線：只偵測到 SCL/SDA 接反', () => {
  load(SAMPLE);
  assert.deepEqual(errors(runChecks(DEFAULT_CODE)), ['SCL 與 SDA 接反']);
});

test('完整接線：沒有錯誤也沒有警告', () => {
  load(FULL);
  const res = runChecks(DEFAULT_CODE);
  assert.deepEqual(res.filter(r => r.sev === 'err' || r.sev === 'warn'), []);
});

test('3V3 直接接 GND 判定為短路並斷電', () => {
  load([['J1-1', 'J1-3']]);
  assert.match(errors(runChecks(DEFAULT_CODE))[0], /短路/);
  load(FULL);
});

test('感測器接 5V 會報錯', () => {
  load(FULL.map(([a, b]) => b === 'SEN.VCC' ? ['J1-2', b] : [a, b]));
  assert.ok(errors(runChecks(DEFAULT_CODE)).includes('感測器 VCC 接到 5V'));
});

test('LED 接到程式沒有控制的腳位會警告', () => {
  load(FULL.map(([a, b]) => b === 'LED.SIG' ? ['J1-6', b] : [a, b]));
  const warns = runChecks(DEFAULT_CODE).filter(r => r.sev === 'warn').map(r => r.title);
  assert.ok(warns.includes('程式沒有控制 PA3'), warns.join(','));
});

test('printf 格式化', () => {
  assert.equal(cfmt('%05.1f|%-4d|%02X|%s|%%', [3.14159, 7, 10, 'ok']), '003.1|7   |0A|ok|%');
  assert.equal(cfmt('%lu MHz', [480]), '480 MHz');
});

test('燒錄後執行：序列埠輸出、按鈕讀值與 LED', async () => {
  load(FULL);
  SIM.senDamaged = false;
  let out = '';
  hooks.serial = s => { out += s; };
  const c = compile(DEFAULT_CODE);
  SIM.flashed = { js:c.js, size:c.size.text };
  startProgram();
  await sleep(250);
  SIM.btn = true;
  await sleep(900);
  stopProgram(true);
  assert.match(out, /Sensor found, ID = 0x60/);
  assert.match(out, /T = \d+\.\d\d C/);
  assert.equal(readPin('PA0'), 1);
  assert.equal(SIM.out.PB14, 1);          // 按鈕按下 → LD3
  assert.equal(SIM.mode.PA5, 'out');
  assert.equal(typeof ledOn(), 'boolean');
  SIM.btn = false;
});
