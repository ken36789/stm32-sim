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
import { setTrace, traceI2C, traceUART, traceSPI, traceCAN, snapshot, tNow, TRACE, utf8 } from '../src/core/trace.js';
import { decodeI2C, decodeUART, decodeSPI, decodeCAN, sampleSig, canFrameBits, crc15 } from '../src/core/protocols.js';
import { capture, analyze } from '../src/core/analyzer.js';
import { nodeOfCan } from '../src/core/buses.js';

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
  const all = TYPE_ORDER.slice(0, 8).map(t => ({ type:t, variant:t === 'pir' ? 'pir-am312' : t === 'relay' ? 'relay-3v' : undefined }));
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
  const src = exampleCode().replace('HAL_Delay(10);', 'HAL_Delay(10)').replace('GPIO_PIN_5', 'GPIO_PIN_16') + '\nvoid f(void){ HAL_RTC_GetTime(0); }\n';
  const msgs = compile(src).diag.map(d => d.msg).join('\n');
  assert.match(msgs, /expected ';' before '}'/);
  assert.match(msgs, /'GPIO_PIN_16' undeclared/);
  assert.match(msgs, /implicit declaration of function 'HAL_RTC_GetTime'/);
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
  const c = compile(exampleCode().replace('SYSCFG_DL_init();', 'SYSCFG_DL_init();\n  DL_WWDT_restart(WWDT0_INST);'));
  assert.equal(c.ok, true);
  assert.match(c.diag.map(d => d.msg).join(), /DL_WWDT_restart.*略過/);
});

/* ---------- 通訊協定與邏輯分析儀 ---------- */
const S = (k, t0, idle = 1) => snapshot(k, t0 - 20, TRACE.cursor + 200, idle);
const packets = r => r.anns.filter(a => /packets$/.test(a.row)).map(a => a.label);

test('協定波形可以正確解碼：I2C（含 NACK）、UART（UTF-8）、SPI、CAN', () => {
  setTrace(true); TRACE.lines.clear(); const t0 = tNow();
  traceI2C('SCL', 'SDA', [{ addr:0x76, read:false, bytes:[0xD0] }, { addr:0x76, read:true, bytes:[0x58] }]);
  traceI2C('SCL', 'SDA', [{ addr:0x48, read:false, bytes:[], nak:true }]);
  traceUART('TX', utf8('溫度 OK\r\n'));
  traceSPI({ sck:'SCK', mosi:'MOSI', miso:'MISO' }, [0x9F, 0, 0, 0], [0xFF, 0xEF, 0x40, 0x16]);
  traceCAN({ bus:'BUS' }, 0x123, [0x00, 0x05, 0x00, 0xFF], { from:'mcu', ack:true });
  traceCAN({ bus:'BUS' }, 0x200, [0x00, 0x07], { from:'node', ack:false });
  assert.deepEqual(packets(decodeI2C(S('SCL', t0), S('SDA', t0))), ['寫 0x76：D0 → 讀 0x76：58', '寫 0x48（NACK）']);
  const u = decodeUART(S('TX', t0), { baud:115200 });
  assert.equal(u.anns.find(a => a.kind === 'utext').d.text, '溫度 OK\r\n');
  assert.equal(u.stats.stdBaud, 115200);
  assert.ok(decodeUART(S('TX', t0), { baud:9600 }).anns.filter(a => a.kind === 'ubyte').length < 3, '鮑率設錯時應該解不出正確內容');
  const sp = decodeSPI(S('SCK', t0, 0), S('MOSI', t0, 0), S('MISO', t0), null, {});
  assert.deepEqual(sp.anns.filter(a => a.row === 'miso').map(a => a.d.value), [0xFF, 0xEF, 0x40, 0x16]);
  assert.notDeepEqual(decodeSPI(S('SCK', t0, 0), S('MOSI', t0, 0), S('MISO', t0), null, { cpha:1 }).anns.filter(a => a.row === 'mosi').map(a => a.d.value), [0x9F, 0, 0, 0]);
  const c = decodeCAN(S('BUS', t0), { bitrate:500e3 });
  assert.deepEqual(packets(c), ['ID 0x123 · 4 位元組 · 00 05 00 FF', 'ID 0x200 · 2 位元組 · 00 07 · 沒有 ACK']);
  assert.equal(c.anns.filter(a => a.kind === 'cerrflag').length, 1);
  assert.ok(c.anns.some(a => a.kind === 'cstuff'), '0x00／0xFF 應該產生填充位元');
  // 取樣率太低：100 kHz 的 I2C 用 150 kS/s 取樣就解不出來
  assert.ok(!packets(decodeI2C(sampleSig(S('SCL', t0), 150e3, t0), sampleSig(S('SDA', t0), 150e3, t0))).includes('寫 0x76：D0 → 讀 0x76：58'));
  assert.deepEqual(packets(decodeI2C(sampleSig(S('SCL', t0), 4e6, t0), sampleSig(S('SDA', t0), 4e6, t0))), ['寫 0x76：D0 → 讀 0x76：58', '寫 0x48（NACK）']);
});

test('CAN 訊框：CRC-15 與位元填充，隨機 ID 與資料都能來回編解碼', () => {
  assert.equal(crc15([]), 0);
  const f = canFrameBits(0x7FF, [0xFF]);
  assert.ok(f.filter(x => x.stuff).length >= 3);
  setTrace(true);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF;
  for (let i = 0; i < 300; i++){
    TRACE.lines.clear(); const t0 = tNow();
    const id = Math.floor(rnd() * 0x800), data = Array.from({ length:Math.floor(rnd() * 9) }, () => rnd() < .3 ? 0 : rnd() < .4 ? 0xFF : Math.floor(rnd() * 256));
    traceCAN({ bus:'B' }, id, data, { from:'mcu', ack:true });
    const p = decodeCAN(S('B', t0), {}).anns.find(a => a.row === 'packets');
    assert.ok(p && p.d.id === id && p.d.data.join() === data.join() && p.d.crcOk && p.d.ackOk, `ID 0x${id.toString(16)} ${data}`);
  }
});

const SPICAN = [{ type:'tc', variant:'max31855' }, { type:'flash' }, { type:'can' }];
test('有 SPI 的晶片都能接熱電偶與 SPI Flash；有 CAN 的晶片都能接收發器，範例程式可編譯、檢測沒有錯誤', () => {
  let spi = 0, can = 0;
  for (const b of BOARDS){
    setup(b.id, SPICAN.filter(m => m.type !== 'can' || b.can).filter(m => m.type === 'can' || b.spi));
    const c = compile(exampleCode());
    assert.equal(c.ok, true, b.id); assert.deepEqual(c.diag, [], b.id);
    assert.deepEqual(problems(runChecks(exampleCode())), [], b.id);
    if (b.spi) spi++; if (b.can) can++;
  }
  assert.ok(spi >= 110 && can >= 50, `SPI ${spi}、CAN ${can}`);
  setup('nucleo-f401re', [{ type:'can' }]);
  assert.ok(problems(runChecks(exampleCode())).some(p => /不能做 CAN 實驗/.test(p)), '沒有 CAN 的晶片要報錯');
});

test('每一種 SDK 都能用 SPI 讀熱電偶、讀寫 Flash，並收發 CAN', async () => {
  const cases = { 'nucleo-f446re':'bxCAN', 'nucleo-g474re':'FDCAN', mspm0g3507:'MCAN', msp430fr2355:'MSP430', tm4c123gh6pm:'TivaWare', tms320f28379d:'C2000', mk64fn1m0vll12:'FlexCAN', lpc55s69jbd100:'LPC55', mimxrt1062dvl6b:'i.MX RT' };
  for (const [id, label] of Object.entries(cases)){
    const b = BOARDS.find(x => x.id === id);
    setup(id, [{ type:'tc', variant:'max6675' }, { type:'flash' }, ...(b.can ? [{ type:'can' }] : [])]);
    const out = await run([/MCU-Lab!/, /熱電偶 溫度 = /, ...(b.can ? [/CAN 收到 ID 0x200/, /CAN 送出/] : [])]);
    assert.match(out, /JEDEC ID = EF 40 16/, `${label}：${out}`);
    assert.match(out, /4D 43 55 2D 4C 61 62 21（MCU-Lab!）/, `${label}：Flash 讀寫`);
    assert.match(out, /熱電偶 溫度 = 2\d\.\d\d/, `${label}：熱電偶`);
    if (b.can){
      assert.match(out, /CAN 收到 ID 0x200/, `${label}：CAN 接收`);
      assert.ok(nodeOfCan(bench.modules[2]).rx.some(f => f.id === 0x123), `${label}：測試節點沒有收到 MCU 的訊框`);
    }
  }
});

test('四種分析儀接上後都能解碼，接錯、沒共地、節點關閉時會說明原因', async () => {
  const mods = [{ type:'temp', variant:'bme280' }, { type:'tc' }, { type:'flash' }, { type:'can' }, { type:'la_i2c' }, { type:'la_uart' }, { type:'la_spi' }, { type:'la_can' }];
  setup('nucleo-f446re', mods);
  assert.deepEqual(problems(runChecks(exampleCode())), []);
  const t0 = tNow();
  await run([/MCU-Lab!/, /CAN 收到/]);
  const opt = { rate:24e6, baud:115200, cpol:0, cpha:0, bitrate:500e3 };
  const la = t => bench.modules.find(m => m.type === t), res = t => analyze(capture(la(t), t0, tNow()), opt);
  for (const t of ['la_i2c', 'la_uart', 'la_spi', 'la_can']){
    const r = res(t);
    assert.ok(r.anns.some(a => /packets$/.test(a.row)), `${t} 沒有解出資料`);
    assert.deepEqual(r.issues.filter(i => i.sev === 'warn' || i.sev === 'err').map(i => i.title), [], t);
  }
  // 解碼設定錯誤
  assert.ok(analyze(capture(la('la_uart'), t0, tNow()), { ...opt, baud:9600 }).issues.some(i => /框架錯誤|鮑率/.test(i.title)));
  assert.ok(analyze(capture(la('la_i2c'), t0, tNow()), { ...opt, rate:100e3 }).issues.some(i => /取樣率/.test(i.title)));
  // 拔掉分析儀的 GND
  const { wires, removeWire } = await import('../src/core/sim.js');
  removeWire(wires.find(w => w.a === `${la('la_i2c').id}.GND` || w.b === `${la('la_i2c').id}.GND`), true); refreshNet();
  assert.ok(problems(runChecks(exampleCode())).some(p => /GND 沒有接/.test(p)));
  assert.ok(res('la_i2c').issues.some(i => /共地/.test(i.title)));
  // 關閉 CAN 測試節點：MCU 的訊框沒有 ACK
  nodeOfCan(la('can') || bench.modules.find(m => m.type === 'can')).on = false;
  const t1 = tNow(); await run([/CAN 送出/]);
  assert.ok(analyze(capture(la('la_can'), t1, tNow()), opt).anns.some(a => a.kind === 'cframenack'));
});

/* ---------- 步進馬達（TB67S128FTG） ---------- */
import { USTEP, dmodeBits, coilCurrents, motorOf, motorInfo, stepperTick, setDiv, setLoad, startManual, stopManual, jumpLimit } from '../src/core/steppers.js';
const STEP2 = [{ type:'stepper' }, { type:'stepper' }];
/** 一邊積分轉子，一邊等 ms 毫秒（模擬每一格畫面呼叫 stepperTick） */
async function spin(ms){ const t0 = Date.now(); while (Date.now() - t0 < ms){ stepperTick(); await sleep(15); } stepperTick(); }

test('TB67S128FTG：DMODE 編碼與線圈電流（全步方波、微步正弦）', () => {
  assert.deepEqual(USTEP.map(dmodeBits), ['000', '001', '010', '011', '100', '101', '110', '111']);
  assert.deepEqual(coilCurrents(0, 1, true), [1, 1]);
  assert.deepEqual(coilCurrents(1, 1, true), [-1, 1]);
  const [a, b] = coilCurrents(4, 16, true);                       // 45° + 4 × 90°/16 ＝ 67.5°
  assert.ok(Math.abs(a - Math.cos(67.5 * Math.PI / 180)) < 1e-9 && Math.abs(b - Math.sin(67.5 * Math.PI / 180)) < 1e-9);
  assert.deepEqual(coilCurrents(3, 16, false), [0, 0]);
});

test('有計時器 PWM 的晶片：兩顆步進馬達的建議接線＋範例程式可編譯、檢測無誤；沒有的會說明', () => {
  let n = 0;
  for (const b of BOARDS){
    setup(b.id, b.step ? STEP2 : [{ type:'stepper' }]);
    if (!b.step){ assert.ok(runChecks(exampleCode()).some(r => r.sev === 'err' && /STEP/.test(r.title)), `${b.id} 應該提示不支援`); assert.equal(compile(exampleCode()).ok, true, b.id); continue; }
    n++;
    const c = compile(exampleCode());
    assert.equal(c.ok, true, `${b.id}: ${JSON.stringify(c.diag)}`);
    assert.deepEqual(c.diag, [], b.id);
    assert.deepEqual(problems(runChecks(exampleCode())), [], b.id);
    assert.match(exampleCode(), /M1_MICROSTEP\s+16/);
  }
  assert.ok(n >= 100, `只有 ${n} 種晶片支援步進馬達`);
});

test('六種 SDK 的計時器 PWM：範例程式讓 M1 加速、來回轉動，沒有失步', async () => {
  const sdks = [...new Set(BOARDS.map(b => b.sdk))];
  assert.equal(sdks.length, 6);
  for (const sdk of sdks){
    const b = BOARDS.find(x => x.sdk === sdk && x.step);
    setup(b.id, STEP2);
    const c = compile(exampleCode()); assert.equal(c.ok, true, b.id);
    hooks.serial = () => {}; SIM.flashed = { js:c.js, size:c.size.text }; startProgram();
    const [m1, m2] = bench.modules; let max = 0, peak = 0;
    const t0 = Date.now(); while (Date.now() - t0 < 1700){ stepperTick(); const i = motorInfo(m1); max = Math.max(max, Math.abs(i.rpm)); peak = Math.max(peak, i.revs); await sleep(15); }
    stopProgram(true);
    assert.ok(peak > 1.1, `${b.id}（${sdk}）M1 只轉了 ${peak.toFixed(2)} 圈`);
    assert.ok(max > 100 && max < 135, `${b.id}（${sdk}）M1 最高 ${max.toFixed(0)} RPM`);
    assert.equal(motorInfo(m1).stalls, 0, `${b.id} M1 失步`);
    assert.ok(Math.abs(motorInfo(m2).revs) > .2, `${b.id} M2 沒有轉`);
  }
});

test('同樣的 pps：微步從 1/16 改成 1/64，轉速只剩四分之一', async () => {
  setup('nucleo-f446re', [{ type:'stepper' }]);
  const m = bench.modules[0]; setLoad(m, 0);
  startManual(m, { pps:3200, accel:12800, steps:Infinity, ramp:true, dir:1 });   // 1/16：3200 pps ＝ 1 圈／秒
  await spin(900);
  assert.ok(Math.abs(motorInfo(m).rpm - 60) < 3, `1/16：${motorInfo(m).rpm}`);
  setDiv(m, 64); await spin(700);
  assert.ok(Math.abs(motorInfo(m).rpm - 15) < 2, `1/64：${motorInfo(m).rpm}`);
  assert.equal(motorInfo(m).lost, 0);
  stopManual(m);
});

test('大飛輪：沒有加減速直接跳到 300 RPM 會失步；用加減速就不會', async () => {
  setup('nucleo-f446re', [{ type:'stepper' }]);
  const m = bench.modules[0]; setLoad(m, 2); setDiv(m, 16);
  const per = 3200;
  assert.ok(jumpLimit(m) < 5, `跳躍上限 ${jumpLimit(m)} 圈／秒`);
  startManual(m, { pps:5 * per, accel:1, steps:Infinity, ramp:false, dir:1 });
  await spin(600);
  assert.ok(motorInfo(m).stalls > 0 && motorInfo(m).lost !== 0, '應該失步');
  stopManual(m);
  // 重新開始：同一顆馬達，1 圈／秒、加速度 2 圈／秒²、走 1 圈
  setup('nucleo-f446re', [{ type:'stepper' }]);
  const m2 = bench.modules[0]; setLoad(m2, 2); setDiv(m2, 16); stepperTick();
  startManual(m2, { pps:per, accel:2 * per, steps:per, ramp:true, dir:1 });
  await spin(1800);
  const i = motorInfo(m2);
  assert.equal(i.stalls, 0); assert.equal(i.lost, 0);
  assert.ok(Math.abs(i.revs - 1) < .02, `走了 ${i.revs} 圈`);
  assert.equal(motorOf(m2).manual.done, true);
});

/* ---------- TB67S128FTG 驅動板（分開接線：驅動板＋馬達＋馬達電源） ---------- */
import { drvStatus, drvOf, coilMap } from '../src/core/steppers.js';
import { wires, removeWire, checkDamage, shorts, net } from '../src/core/sim.js';
const FULL = [{ type:'tb67' }, { type:'motor' }, { type:'psu' }];
const W = (a, b) => wires.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
const wireOfPin = id => wires.find(w => w.a === id || w.b === id);
async function runFor(ms){ const c = compile(exampleCode()); assert.equal(c.ok, true, JSON.stringify(c.diag)); hooks.serial = () => {}; SIM.flashed = { js:c.js, size:c.size.text }; startProgram(); let lo = 0, hi = 0; const t0 = Date.now(); while (Date.now() - t0 < ms){ stepperTick(); const r = motorInfo(bench.modules.find(m => m.type === 'motor')).revs; lo = Math.min(lo, r); hi = Math.max(hi, r); await sleep(15); } stopProgram(true); return { lo, hi }; }

test('TB67S128FTG 驅動板：19 支腳都有說明，建議接線後每一支必要的腳都正確', () => {
  assert.equal(MODULE_TYPES.tb67.pins.length, 19);
  for (const [n, f] of MODULE_TYPES.tb67.pins) assert.ok(f.length > 12, n);
  for (const b of BOARDS.filter(x => x.step)){
    setup(b.id, [...FULL.slice(0, 2), { type:'tb67' }, { type:'motor' }, FULL[2]]);
    const c = compile(exampleCode());
    assert.equal(c.ok, true, `${b.id}: ${JSON.stringify(c.diag)}`);
    assert.deepEqual(c.diag, [], b.id);
    assert.deepEqual(problems(runChecks(exampleCode())), [], b.id);
    for (const d of bench.modules.filter(m => m.type === 'tb67')){
      const st = drvStatus(d);
      assert.ok(st.vmOk && st.gndMcu, `${b.id} 驅動板沒有電或沒共地`);
      assert.ok(coilMap(bench.modules.find(m => m.type === 'motor' && coilMap(m).drv === d)).normal, `${b.id} 馬達線序`);
    }
  }
});

test('各家 SDK：MCU → TB67S128FTG → 馬達，兩顆都會轉', async () => {
  for (const sdk of [...new Set(BOARDS.map(b => b.sdk))]){
    const b = BOARDS.find(x => x.sdk === sdk && x.step);
    setup(b.id, [{ type:'tb67' }, { type:'motor' }, { type:'tb67' }, { type:'motor' }, { type:'psu' }]);
    const c = compile(exampleCode()); assert.equal(c.ok, true, b.id);
    hooks.serial = () => {}; SIM.flashed = { js:c.js, size:c.size.text }; startProgram();
    const ms = bench.modules.filter(m => m.type === 'motor'); let peak = 0;
    const t0 = Date.now(); while (Date.now() - t0 < 1500){ stepperTick(); peak = Math.max(peak, motorInfo(ms[0]).revs); await sleep(15); }
    stopProgram(true);
    assert.ok(peak > 1, `${b.id}（${sdk}）M1 只轉了 ${peak.toFixed(2)} 圈`);
    assert.ok(Math.abs(motorInfo(ms[1]).revs) > .2, `${b.id} M2 沒有轉`);
    assert.equal(motorInfo(ms[0]).stalls, 0, `${b.id} 失步`);
  }
});

test('TB67S128FTG 接錯時的行為和 datasheet 一樣（反轉、ISD、OPD、共地、待機、低電壓、燒毀）', async () => {
  const swap = (d, m, x, y) => { removeWire(W(`${d}.${x}`, `${m}.${x}`), true); removeWire(W(`${d}.${y}`, `${m}.${y}`), true); addWire(`${d}.${x}`, `${m}.${y}`, null, true); addWire(`${d}.${y}`, `${m}.${x}`, null, true); refreshNet(); };
  const ids = () => { const d = bench.modules.find(m => m.type === 'tb67'), m = bench.modules.find(x => x.type === 'motor'), p = bench.modules.find(x => x.type === 'psu'); return { d, m, p }; };
  const titles = () => problems(runChecks(exampleCode())).join(' | ');
  // 一組線圈反接：還是會轉，但方向相反（檢測只提示）
  setup('nucleo-f446re', FULL); let { d, m } = ids(); swap(d.id, m.id, 'A+', 'A-');
  let r = await runFor(1300); assert.ok(r.lo < -.9 && r.hi < .05, `反接 ${r.lo}..${r.hi}`); assert.equal(titles(), '');
  // A−、B− 對調：接錯相 → 過電流保護（ISD），LO0 被拉低，程式會印出錯誤
  setup('nucleo-f446re', FULL); ({ d, m } = ids()); swap(d.id, m.id, 'A-', 'B-');
  r = await runFor(1300); assert.equal(drvOf(d).fault, 'ISD'); assert.ok(Math.abs(r.hi) < .01); assert.match(titles(), /接錯相/);
  // 拔掉一條馬達線 → OPD
  setup('nucleo-f446re', FULL); ({ d, m } = ids()); removeWire(W(`${d.id}.B-`, `${m.id}.B-`), true); refreshNet();
  await runFor(600); assert.equal(drvOf(d).fault, 'OPD'); assert.match(titles(), /沒接好/);
  // 沒有共地、STBY 沒接：不會動
  setup('nucleo-f446re', FULL); ({ d } = ids()); removeWire(wireOfPin(`${d.id}.GND`), true); refreshNet();
  r = await runFor(600); assert.ok(r.hi < .01); assert.match(titles(), /沒有和 MCU 共地/);
  setup('nucleo-f446re', FULL); ({ d } = ids()); removeWire(wireOfPin(`${d.id}.STBY`), true); refreshNet();
  r = await runFor(600); assert.ok(r.hi < .01); assert.match(titles(), /STBY 沒有接/);
  // 5 V 電源：低電壓保護
  setup('nucleo-f446re', [FULL[0], FULL[1], { type:'psu', variant:'psu-5' }]); ({ d } = ids());
  r = await runFor(600); assert.ok(r.hi < .01); assert.equal(drvStatus(d).vmOk, false); assert.match(titles(), /只有 5 V/);
  // 邏輯腳接到 24 V：驅動板燒毀；V+ 接到 MCU 腳：開發板斷電
  setup('nucleo-f446re', FULL); let p; ({ d, p } = ids()); removeWire(wireOfPin(`${d.id}.EN`), true); addWire(`${p.id}.V+`, `${d.id}.EN`, null, true); refreshNet();
  assert.deepEqual(checkDamage().map(x => x.id), [d.id]); assert.match(titles(), /燒毀/);
  setup('nucleo-f446re', FULL); ({ d, p } = ids()); const g = wireOfPin(`${d.id}.DIR`), mcu = g.a === `${d.id}.DIR` ? g.b : g.a; removeWire(g, true); addWire(`${p.id}.V+`, mcu, null, true); refreshNet();
  assert.ok(shorts().some(s => s.type === 'hv')); assert.equal(SIM.usb && !shorts().some(s => s.type !== 'psu'), false);
});

test('用一般 GPIO 切換 CLK 也能一步一步推動馬達；MODE 腳接線決定微步', async () => {
  setup('nucleo-f446re', FULL);
  const d = bench.modules.find(m => m.type === 'tb67'), m = bench.modules.find(x => x.type === 'motor');
  const clk = wireOfPin(`${d.id}.CLK`); removeWire(clk, true);
  const free = bench.board.header.find(h => h.kind === 'gpio' && !net(h.mcu).some(x => x !== h.mcu) && !h.tags.some(t => ['vcp', 'led', 'scl', 'sda'].includes(t)) && h.label !== 'D9' && h.mcu !== bench.board.btn?.pin);
  addWire(free.id, `${d.id}.CLK`, null, true);
  // MODE2 接 3V3：MODE2..0＝100 → 1/16（沒接的兩支是低電位）
  addWire('R.+9', `${d.id}.MODE2`, null, true); refreshNet();
  assert.equal(drvStatus(d).div, 16); assert.equal(drvStatus(d).modeWired, true);
  const port = free.mcu.match(/^P([A-K])(\d+)$/);
  const code = exampleCode().replace(/while \(1\)\s*\{/, `while (1)\n  {\n    for (int s = 0; s < 400; s++) { HAL_GPIO_TogglePin(GPIO${port[1]}, GPIO_PIN_${port[2]}); }`);
  const c = compile(code); assert.equal(c.ok, true, JSON.stringify(c.diag));
  hooks.serial = () => {}; SIM.flashed = { js:c.js, size:c.size.text }; startProgram();
  await until(() => { stepperTick(); return Math.abs(motorInfo(m).revs) > .05; }, 3000); stopProgram(true);
  assert.ok(Math.abs(motorInfo(m).revs) > .05, `GPIO 切換只轉了 ${motorInfo(m).revs}`);
});
