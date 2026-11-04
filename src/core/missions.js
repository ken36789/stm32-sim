// 闖關課程與故障挑戰。每一關的步驟都用模擬器的實際狀態即時判定（接線、程式有沒有在跑、序列埠輸出、模組狀態、馬達位置）。
// 判定用的 c（context）由介面每 0.2 秒提供：
//   c.b 開發板、c.scl／c.sda I2C 腳（MCU 名稱）、c.m(type) 找模組、c.exp(m, n) 程式預期的 MCU 腳、c.label(mcu) 排針名稱、
//   c.running 程式依照目前的接線與程式碼燒錄並正在執行、c.serial 這次重設以來的序列埠輸出、
//   c.cnt／c.v 這一關自己的計數器與變數（watch 每次更新）、c.flag 介面事件（分析儀解碼、打開示波器…）
import { bench, wires, netInfo, moduleState, PINS, addWire, removeWire, refreshNet, headerPin } from './sim.js';
import { BOARD_BY_ID, DEFAULT_BOARD } from './boards.js';
import { coilMap, drvStatus, motorInfo, drvOf } from './steppers.js';
import { suggestWiring, exampleCode } from './codegen.js';
import { loadBench, snapshot } from './project.js';

const P = (m, n) => `${m.id}.${n}`;
export const J = {
  gpio:(m, n) => netInfo(P(m, n)).gpio[0] || null,
  on:(m, n, mcu) => !!mcu && netInfo(P(m, n)).gpio.includes(mcu),
  gnd:(m, n = 'GND') => netInfo(P(m, n)).gnd,
  v33:(m, n = 'VCC') => { const i = netInfo(P(m, n)); return i.v33 && !i.v5; },
  v5:(m, n = 'VCC') => netInfo(P(m, n)).v5,
};
/** 序列埠輸出裡所有符合 re 的數字（第一個括號） */
export const nums = (s, re) => [...s.matchAll(re)].map(x => parseFloat(x[1]));
const temps = s => [...s.matchAll(/溫度 = (-?\d+)\.(\d+)/g)].map(x => parseFloat(`${x[1]}.${x[2]}`));
const adcMax = b => 2 ** b.adcBits - 1;

/* ---------- 共用的觀察器：數次數、記錄最大最小 ---------- */
// 用 GPIO 的邊緣事件計數（不靠輪詢，畫面很慢的裝置也不會漏掉）。edge(c, pin, v) 在每次 GPIO 改變時呼叫
const blinkEdge = type => (c, pin) => { const m = c.m(type); if (m && c.running && J.gnd(m) && netInfo(P(m, 'SIG')).gpio.includes(pin)) c.cnt.blink = (c.cnt.blink || 0) + 1; };
const pressEdge = (btnType, outType) => (c, pin, v) => {
  const b = c.m(btnType), o = c.m(outType); if (!b || !o || !c.running || !netInfo(P(o, 'SIG')).gpio.includes(pin) || !J.gnd(o)) return;
  const pressed = !!moduleState(b).pressed;
  if (v === 1 && pressed){ c.cnt.hit = (c.cnt.hit || 0) + 1; c.v.armed = true; }
  if (v === 0 && !pressed && c.v.armed){ c.cnt.release = (c.cnt.release || 0) + 1; c.v.armed = false; }
};
const motorWatch = c => {
  const m = c.m('motor'); if (!m) return;
  const r = motorInfo(m).revs;
  if (!c.running){ c.v.lo = c.v.hi = undefined; return; }
  c.v.lo = Math.min(c.v.lo ?? r, r); c.v.hi = Math.max(c.v.hi ?? r, r);
  c.v.moved = Math.max(c.v.moved || 0, c.v.hi - c.v.lo);           // 這次執行以來轉過的範圍（來回轉也算）
};

/* ---------- 闖關課程 ---------- */
export const MISSIONS = [
  {
    id:'m1', no:1, title:'點亮外接 LED', short:'GPIO 輸出、共地', mods:[{ type:'led', variant:'led-red' }],
    intro:'程式已經寫好了：它每 0.5 秒切換一次外接 LED。你的任務是讀懂程式，照著程式把線接上，讓 LED 真的閃起來。',
    steps:[
      { t:'LED 的 SIG 接到程式控制的那支腳', ok:c => J.on(c.m('led'), 'SIG', c.exp(c.m('led'), 'SIG')) },
      { t:'LED 的 GND 接到開發板的 GND', ok:c => J.gnd(c.m('led')) },
      { t:'依序完成「檢測 → 編譯 → 燒錄」', ok:c => c.running },
      { t:'看到 LED 閃爍 4 次', ok:c => (c.cnt.blink || 0) >= 4 },
    ],
    edge:blinkEdge('led'),
    hints:[
      '到「程式」分頁，最上面的 #define LED_EXT… 那一行，註解寫了 LED 要接哪一支腳。',
      c => `LED_EXT 用的是 ${c.label(c.exp(c.m('led'), 'SIG'))}。在 3D 畫面先點 LED 模組的 SIG（金色腳），再點開發板排針上的 ${c.label(c.exp(c.m('led'), 'SIG'))}。`,
      'GND 可以直接接到排針上任何一個 GND；也可以先把排針的 GND 接到電源軌 −，再從電源軌接過來（多個模組比較好分）。',
    ],
    learn:'GPIO 輸出高電位時，電流從 SIG 經過 LED 和限流電阻流到 GND。沒有接 GND 就沒有迴路，LED 不會亮——這就是「共地」。程式只能控制它知道的那一支腳，所以接線一定要和程式裡的 #define 一樣。',
  },
  {
    id:'m2', no:2, title:'按鈕控制蜂鳴器', short:'GPIO 輸入 → 判斷 → 輸出', mods:[{ type:'button', variant:'btn-tact' }, { type:'buzzer', variant:'buz-3v' }],
    intro:'程式會一直讀按鈕：按下時讓蜂鳴器響，放開就停。把按鈕和蜂鳴器接好，然後按住按鈕試試看。（右上角「聲音」打開可以聽到聲音）',
    steps:[
      { t:'按鈕的 VCC 接 3V3、GND 接地', ok:c => J.v33(c.m('button')) && J.gnd(c.m('button')) },
      { t:'按鈕的 OUT 接到程式讀取的那支腳', ok:c => J.on(c.m('button'), 'OUT', c.exp(c.m('button'), 'OUT')) },
      { t:'蜂鳴器的 SIG 接到程式控制的腳、GND 接地', ok:c => J.on(c.m('buzzer'), 'SIG', c.exp(c.m('buzzer'), 'SIG')) && J.gnd(c.m('buzzer')) },
      { t:'依序完成「檢測 → 編譯 → 燒錄」', ok:c => c.running },
      { t:'按住按鈕，蜂鳴器響了', ok:c => (c.cnt.hit || 0) >= 1 },
      { t:'放開按鈕，蜂鳴器停了', ok:c => (c.cnt.release || 0) >= 1 },
    ],
    edge:pressEdge('button', 'buzzer'),
    hints:[
      '按鈕模組按下時 OUT 輸出高電位，所以它的 VCC 要接 3V3（接 5V 會把 5 V 送進 GPIO，有些腳不耐 5 V）。',
      c => `程式讀的是 ${c.label(c.exp(c.m('button'), 'OUT'))}（BTN），控制的是 ${c.label(c.exp(c.m('buzzer'), 'SIG'))}（BUZZER）。到「程式」分頁看最上面的 #define。`,
      '按鈕要「按住」：在 3D 畫面長按按鈕模組的黑色按鍵，或到「元件」分頁點按鈕，按住「按住這裡＝按下按鈕」。',
    ],
    learn:'MCU 用 GPIO 輸入讀到 1，再用 GPIO 輸出讓蜂鳴器響：「輸入 → 判斷 → 輸出」是所有嵌入式程式的基本架構。程式每 10 ms 讀一次按鈕，所以反應看起來是即時的。',
  },
  {
    id:'m3', no:3, title:'旋鈕和 ADC', short:'類比轉數位、3.3 V 上限', mods:[{ type:'pot', variant:'pot-rotary' }],
    intro:'旋鈕（電位器）會輸出 0 到電源電壓之間的電壓。MCU 的 ADC 把電壓換成數字，程式每秒印一次。把旋鈕接好，轉到最大、再轉到最小。',
    steps:[
      { t:'旋鈕的 VCC 接 3V3（不是 5V）、GND 接地', ok:c => J.v33(c.m('pot')) && J.gnd(c.m('pot')) },
      { t:'OUT 接到程式讀取的類比輸入腳', ok:c => J.on(c.m('pot'), 'OUT', c.exp(c.m('pot'), 'OUT')) },
      { t:'依序完成「檢測 → 編譯 → 燒錄」', ok:c => c.running },
      { t:'轉到最大：序列埠讀到 90% 以上', ok:c => c.v.hi === true },
      { t:'再轉到最小：讀到 10% 以下', ok:c => c.v.lo === true },
    ],
    watch:c => { if (!c.running) return; const max = adcMax(c.b), v = nums(c.serial, /ADC = +(\d+)/g); for (const x of v){ if (x >= max * .9) c.v.hi = true; if (c.v.hi && x <= max * .1) c.v.lo = true; } },
    hints:[
      c => `這塊板子的 ADC 是 ${c.b.adcBits} 位元：0 V 讀到 0，3.3 V 讀到 ${adcMax(c.b)}。`,
      c => `OUT 要接 ${c.label(c.exp(c.m('pot'), 'OUT'))}（程式讀的類比腳），不是每一支腳都有 ADC。`,
      '轉旋鈕：到「元件」分頁點旋鈕，拖曳「旋鈕位置」滑桿。序列埠每秒印一次讀值。',
    ],
    learn:'12 位元 ADC 把 0–3.3 V 切成 4096 階。如果 VCC 接 5V，轉到三分之二以上電壓就超過 3.3 V：讀值卡在最大值，還可能傷到腳位——所以類比感測器的電源要和 MCU 一樣是 3.3 V。',
  },
  {
    id:'m4', no:4, title:'I2C 溫度感測器', short:'兩條線、位址、讀暫存器', mods:[{ type:'temp', variant:'bme280' }],
    intro:'BME280 用 I2C 介面：SCL 是時脈、SDA 是資料，兩條線就能讀溫度。接好之後，用手指按住感測器讓它變熱。',
    steps:[
      { t:'VCC 接 3V3、GND 接地', ok:c => J.v33(c.m('temp')) && J.gnd(c.m('temp')) },
      { t:c => `SCL 接到 I2C 的 SCL（${c.label(c.scl)}）`, ok:c => J.on(c.m('temp'), 'SCL', c.scl) },
      { t:c => `SDA 接到 I2C 的 SDA（${c.label(c.sda)}）`, ok:c => J.on(c.m('temp'), 'SDA', c.sda) },
      { t:'依序完成「檢測 → 編譯 → 燒錄」', ok:c => c.running },
      { t:'序列埠讀到溫度', ok:c => temps(c.serial).length > 0 },
      { t:'用手指按住感測器，讀到的溫度上升 1 °C 以上', ok:c => { const t = temps(c.serial); return t.length > 1 && Math.max(...t) - t[0] >= 1; } },
    ],
    hints:[
      c => `I2C 的腳是固定的：這塊板子的 SCL 在 ${c.label(c.scl)}、SDA 在 ${c.label(c.sda)}。不能隨便換腳。`,
      'SCL 和 SDA 很容易接反。接反時程式會印出「讀取失敗」——檢測也會告訴你。',
      '加溫：在 3D 畫面點感測器上的小晶片（等於用手指按住），點幾次溫度會一直往上。',
    ],
    learn:'I2C 只用兩條線就能接很多元件，每個元件有自己的位址（BME280 是 0x76）。MCU 先送出位址，對的元件才會回 ACK。BME280 讀出來的是原始數字，要用晶片裡的校正係數算出溫度——範例程式的 TEMP_Read() 就在做這件事。',
  },
  {
    id:'m5', no:5, title:'用邏輯分析儀看 UART', short:'起始位元、鮑率', mods:[{ type:'la_uart' }],
    intro:'printf 的文字是用 UART 一個位元一個位元送出去的。把 UART 分析儀的探棒接到 MCU 的 TX，就能看到真正的波形，再故意把鮑率設錯看看會怎樣。',
    steps:[
      { t:'分析儀的 GND 接到開發板的 GND', ok:c => J.gnd(c.m('la_uart')) },
      { t:c => `TX 探棒接到 MCU 的 TX（${c.label(c.b.vcp.tx)}）`, ok:c => J.on(c.m('la_uart'), 'TX', c.b.vcp.tx) },
      { t:'依序完成「檢測 → 編譯 → 燒錄」', ok:c => c.running },
      { t:'點 3D 畫面上的分析儀，擷取到 UART 文字', ok:c => !!c.flag.uartOk },
      { t:'把鮑率改成 9600，看到解碼錯誤', ok:c => !!c.flag.uartBad },
    ],
    hints:[
      c => `MCU 的 printf 走 ${c.b.vcp.periph}，TX 腳是 ${c.label(c.b.vcp.tx)}。探棒只是「量」電壓，接上去不會影響序列埠。`,
      '分析儀量的是「探棒和 GND 之間的電壓」，所以 GND 一定要接。',
      '打開分析儀後按「擷取」；上方的「鮑率」下拉選單改成 9600，再看「說明」分頁。',
    ],
    learn:'UART 平常是高電位；起始位元拉低一個位元時間，接著送 8 個資料位元（低位先送），最後停止位元回到高電位。兩邊的鮑率必須一樣（115200 bps 時一個位元約 8.7 µs），設錯的話每個位元的寬度都對不上，就會出現框架錯誤和亂碼。',
  },
  {
    id:'m6', no:6, title:'TB67S128FTG 推動步進馬達', short:'馬達電源、共地、STEP／DIR', mods:[{ type:'tb67' }, { type:'motor' }, { type:'psu', variant:'psu-24' }],
    intro:'步進馬達要大電流，不能直接接 MCU：中間要有驅動板。右側接馬達電源和馬達，左側接 MCU。程式會讓馬達加速、來回轉 2 圈。',
    steps:[
      { t:'馬達電源 V+ → 驅動板 VIN、V− → PGND', ok:c => drvStatus(c.m('tb67')).vmOk },
      { t:'驅動板的 GND 接 MCU 的 GND、IOREF 接 3V3', ok:c => { const d = c.m('tb67'); return netInfo(P(d, 'GND')).gnd && J.v33(d, 'IOREF'); } },
      { t:'STBY、EN、DIR 接到程式控制的腳', ok:c => { const d = c.m('tb67'); return ['STBY', 'EN', 'DIR'].every(n => J.on(d, n, c.exp(d, n))); } },
      { t:'CLK 接到程式用的計時器 PWM 腳、LO0 接到程式讀的腳', ok:c => { const d = c.m('tb67'); return J.on(d, 'CLK', c.exp(d, 'CLK')) && J.on(d, 'LO0', c.exp(d, 'LO0')); } },
      { t:'四條馬達線接到驅動板的 A+、A−、B+、B−', ok:c => !!coilMap(c.m('motor')).ok },
      { t:'依序完成「檢測 → 編譯 → 燒錄」', ok:c => c.running },
      { t:'馬達轉了 1 圈以上', ok:c => (c.v.moved || 0) >= 1 },
    ],
    watch:motorWatch,
    hints:[
      '到「元件」分頁點驅動板：接線圖和接線表會一支一支告訴你接對了沒有。',
      c => { const d = c.m('tb67'); return `程式用的腳：STBY ${c.label(c.exp(d, 'STBY'))}、EN ${c.label(c.exp(d, 'EN'))}、DIR ${c.label(c.exp(d, 'DIR'))}、CLK ${c.label(c.exp(d, 'CLK'))}（計時器 PWM）、LO0 ${c.label(c.exp(d, 'LO0'))}。`; },
      '馬達線照顏色：A+ 黑、A− 綠、B+ 紅、B− 藍。左右兩側的 GND 在板上相通，所以 PGND 接 V−、GND 接 MCU，就共地了。',
    ],
    learn:'MCU 只送 STEP 脈波和方向，電流由驅動 IC 控制。每個 STEP 脈波前進一個微步（1/16 時是 0.1125°），所以脈波的頻率決定轉速、脈波的數量決定轉了多少。打開步進馬達示波器，可以看到加速、等速、減速的梯形速度曲線。',
  },
];

/* ---------- 故障挑戰：程式已經燒好在跑，但是有地方錯了 ---------- */
const swapWires = (api, a, b) => { const wa = api.wireAt(a), wb = api.wireAt(b); if (!wa || !wb) return; const oa = wa.a === a ? wa.b : wa.a, ob = wb.a === b ? wb.b : wb.a; api.unwire(wa); api.unwire(wb); api.wire(a, ob); api.wire(b, oa); };
const moveWire = (api, pin, to) => { const w = api.wireAt(pin); if (w) api.unwire(w); api.wire(pin, to); };
export const CHALLENGES = [
  { id:'c1', no:1, title:'LED 不會亮', mods:[{ type:'led', variant:'led-red' }],
    symptom:'程式在跑，板載 LED 也在閃，可是外接的 LED 一直不亮。',
    bug:(api, c) => api.unwire(api.wireAt(P(c.m('led'), 'GND'))),
    fixed:c => (c.cnt.blink || 0) >= 3, edge:blinkEdge('led'),
    hints:['LED 要亮，電流要有完整的迴路：從 GPIO 出來，經過 LED，回到哪裡？', '看看 LED 模組的每一支腳都有接線嗎？'],
    learn:'LED 的 GND 沒接：電流沒有回路，GPIO 輸出高電位也不會有電流。所有模組都要和開發板共地。' },
  { id:'c2', no:2, title:'按鈕按了沒反應', mods:[{ type:'button', variant:'btn-tact' }, { type:'buzzer', variant:'buz-3v' }],
    symptom:'按住按鈕，蜂鳴器完全沒反應。接線看起來都有接。',
    bug:(api, c) => moveWire(api, P(c.m('button'), 'OUT'), api.freeGpio()),
    fixed:c => (c.cnt.hit || 0) >= 1, edge:pressEdge('button', 'buzzer'),
    hints:['程式讀的是哪一支腳？到「程式」分頁看 #define BTN 那一行。', '按鈕的 OUT 真的接在那一支腳上嗎？'],
    learn:'按鈕接到了別的腳：程式讀的那支腳一直是低電位。接線一定要和程式裡的腳位定義一致；接線檢測會提示「程式沒有讀取 …」。' },
  { id:'c3', no:3, title:'旋鈕轉到一半就卡住', mods:[{ type:'pot', variant:'pot-rotary' }],
    symptom:'旋鈕轉到大約三分之二以後，ADC 讀值就停在最大值不動了。',
    bug:(api, c) => moveWire(api, P(c.m('pot'), 'VCC'), api.header('5V')),
    fixed:c => J.v33(c.m('pot')) && c.running && nums(c.serial, /ADC = +(\d+)/g).length > 0,
    hints:['讀值卡在最大值，代表輸入電壓超過了 ADC 能量的範圍。ADC 最高只能量多少伏特？', '旋鈕的 VCC 接到哪裡？'],
    learn:'旋鈕的 VCC 接到 5V：轉到 2/3 以上 OUT 就超過 3.3 V，ADC 只能讀到最大值，而且超過 3.3 V 會傷到腳位。類比感測器的電源要接 3V3。' },
  { id:'c4', no:4, title:'溫度讀取失敗（接線）', mods:[{ type:'temp', variant:'bme280' }],
    symptom:'序列埠一直印「讀取失敗」，感測器的電源燈是亮的。',
    bug:(api, c) => swapWires(api, P(c.m('temp'), 'SCL'), P(c.m('temp'), 'SDA')),
    fixed:c => c.running && temps(c.serial).length > 0,
    hints:['電源正常、程式也對，那就是兩條訊號線的問題。I2C 有哪兩條線？', '比對一下：SCL 和 SDA 各接到開發板的哪一支腳？'],
    learn:'SCL 和 SDA 接反了：MCU 在 SDA 上送時脈、在 SCL 上送資料，感測器看不懂，不會回 ACK。用邏輯分析儀看 I2C 會發現位址之後都是 NACK。' },
  { id:'c5', no:5, title:'溫度讀取失敗（程式）', mods:[{ type:'temp', variant:'bme280' }],
    symptom:'接線全部正確（檢測也通過），序列埠卻印「沒有回應」。',
    code:src => src.replace(/(#define TEMP_ADDR\s+)0x76/, '$10x77'),
    fixed:c => c.running && temps(c.serial).length > 0,
    hints:['接線沒問題，那就看程式：MCU 找感測器時用的是哪一個 I2C 位址？', '到「元件」分頁看 BME280 的規格：模組上的位址是多少？'],
    learn:'程式裡的 I2C 位址寫成 0x77，但這塊 BME280 模組的位址是 0x76（SDO 接地）。位址不對就沒有元件回 ACK——接線再正確也讀不到。' },
  { id:'c6', no:6, title:'繼電器吸不動', mods:[{ type:'relay', variant:'relay-5v' }],
    symptom:'程式每 2 秒切換一次繼電器，指示燈有反應，但是聽不到「喀」的吸合聲，接點也沒有導通。',
    bug:(api, c) => moveWire(api, P(c.m('relay'), 'VCC'), api.rail('+')),
    fixed:c => { const m = c.m('relay'); if (c.running && moduleState(m).on) c.v.on = true; return !!c.v.on; },
    hints:['繼電器裡面是一個電磁鐵，需要夠大的電壓才吸得動。這顆是幾伏特的繼電器？', '看看 VCC 接到哪裡。'],
    learn:'5 V 的繼電器線圈只接 3.3 V，磁力不夠，吸不動接點。線圈電源要符合繼電器的規格（或換成 3 V 繼電器）。' },
  { id:'c7', no:7, title:'Flash 讀出來全是 FF', mods:[{ type:'flash', variant:'w25q32' }], needs:'spi',
    symptom:'序列埠印「沒有回應，請檢查 SPI 接線」，讀出來的資料全是 FF。',
    bug:(api, c) => swapWires(api, P(c.m('flash'), 'DI'), P(c.m('flash'), 'DO')),
    fixed:c => c.running && /位址 0x000000/.test(c.serial) && !/沒有回應/.test(c.serial),
    hints:['SPI 有兩條資料線，一條「進」一條「出」。名稱是從誰的角度看的？', 'Flash 的 DI 要接 MCU 的 MOSI、DO 要接 MISO。'],
    learn:'DI 和 DO 接反了：DI（資料輸入）是從 Flash 的角度看的，要接主機的輸出 MOSI；DO 接 MISO。接反時 Flash 收不到指令，MISO 一直是高電位，讀到的都是 0xFF。' },
  { id:'c8', no:8, title:'CAN 沒有回應', mods:[{ type:'can', variant:'can-230' }], needs:'can',
    symptom:'序列埠一直印「CAN 送出」，卻從來沒有「CAN 收到」。',
    bug:(api, c) => swapWires(api, P(c.m('can'), 'TXD'), P(c.m('can'), 'RXD')),
    fixed:c => c.running && /CAN 收到/.test(c.serial),
    hints:['收發器的 TXD／RXD 和 MCU 的 CAN_TX／CAN_RX，誰該接誰？', '「TX 接 TX」：收發器的 TXD 是它的輸入，接 MCU 送出的 CAN_TX。'],
    learn:'TXD 和 RXD 接反：MCU 送出的訊號進不了收發器，收發器收到的也回不了 MCU。CAN 收發器的 TXD 接 MCU 的 CAN_TX、RXD 接 CAN_RX（和 UART 的交叉接法不一樣）。' },
  { id:'c9', no:9, title:'步進馬達完全不動', mods:[{ type:'tb67' }, { type:'motor' }, { type:'psu', variant:'psu-24' }], needs:'step',
    symptom:'馬達電源是開的，驅動板的電源燈也亮著，程式在跑，馬達卻一動也不動。',
    bug:(api, c) => api.unwire(api.wireAt(P(c.m('tb67'), 'GND'))),
    fixed:c => (c.v.moved || 0) >= .5, watch:motorWatch,
    hints:['驅動板有電，代表右側沒問題。STEP、DIR、ENABLE 這些訊號的電壓是相對於什麼來量的？', '到「元件」分頁點驅動板，看接線表的第一列。'],
    learn:'驅動板左側的 GND 沒接到 MCU：MCU 送出的 3.3 V 訊號沒有共同的參考點，驅動板看不到 STANDBY、ENABLE 和 STEP。馬達電源的 V− 接在 PGND 不代表和 MCU 共地——MCU 的 GND 也要接過來。' },
  { id:'c10', no:10, title:'步進馬達只會抖', mods:[{ type:'tb67' }, { type:'motor' }, { type:'psu', variant:'psu-24' }], needs:'step',
    symptom:'馬達接上之後完全不轉，驅動板的紅色錯誤燈亮了，序列埠每秒印一次「回報錯誤」。',
    bug:(api, c) => swapWires(api, P(c.m('motor'), 'A-'), P(c.m('motor'), 'B-')),
    fixed:c => (c.v.moved || 0) >= .5 && !drvOf(c.m('tb67')).fault, watch:motorWatch,
    hints:['錯誤旗標說的是「過電流」：輸出端好像短路了。馬達的四條線分成哪兩組？', '同一組線圈的兩條線，要接到驅動板的同一相（A+／A− 或 B+／B−）。'],
    learn:'A− 和 B− 對調了：一組線圈跨在 A 相和 B 相之間，兩個 H 橋經過線圈互相短路，驅動 IC 偵測到過電流（ISD）就關閉輸出並鎖住。換回正確線序後，程式把 STANDBY 拉低再拉高就能清除錯誤。' },
];
export const ALL = [...MISSIONS.map(x => ({ ...x, kind:'mission' })), ...CHALLENGES.map(x => ({ ...x, kind:'challenge' }))];
export const byId = id => ALL.find(x => x.id === id);
/** 這一關需要的功能，目前的開發板有沒有 */
export const boardFits = (b, x) => (!x.needs || !!b[x.needs]) && (!x.mods.some(m => m.type === 'tb67') || !!b.step);
/** 星等：沒看提示 3 顆、看了提示 2 顆、看了解答 1 顆 */
export const starsOf = (hints, answer) => answer ? 1 : hints ? 2 : 3;

/* ---------- 準備一關、判定 ---------- */
/** 改接線用的小工具（故障挑戰製造問題用） */
const isFree = id => !wires.some(w => w.a === id || w.b === id);
export const wireApi = {
  wireAt:id => wires.find(w => w.a === id || w.b === id),
  unwire:w => { if (w) removeWire(w, true); },
  wire:(a, b) => { if (a && b) addWire(a, b, null, true); },
  header:label => bench.board.header.find(h => h.label === label && isFree(h.id))?.id,
  rail:sign => { for (let k = 1; k <= 14; k++){ const id = `R.${sign}${k}`; if (PINS[id] && isFree(id)) return id; } return null; },
  freeGpio:() => { const b = bench.board, step = new Set((b.step || []).map(x => headerPin(x.pin)?.id)); return b.header.find(h => h.kind === 'gpio' && isFree(h.id) && !step.has(h.id) && !h.tags.some(t => ['vcp', 'led', 'scl', 'sda', 'sck', 'miso', 'mosi', 'cantx', 'canrx', 'adc'].includes(t)) && h.mcu !== b.btn?.pin)?.id; },
};
/** 擺好這一關的工作台。闖關：只放模組（線讓使用者自己接）；故障挑戰：接好、產生程式，再製造問題。
 *  回傳 { board, exp（模組腳 → 程式預期的 MCU 腳）, code（給使用者的程式）, fix（正確的作品，看解答用）} */
export function prepare(x, boardId){
  const b0 = BOARD_BY_ID[boardId], board = b0 && boardFits(b0, x) ? boardId : DEFAULT_BOARD;
  loadBench({ board, modules:x.mods.map(m => ({ type:m.type, variant:m.variant })) });
  refreshNet();
  const sug = suggestWiring(), exp = {};
  for (const [a, b] of sug) for (const [mp, hp] of [[a, b], [b, a]]) if (/^M\d+\./.test(mp) && PINS[hp]?.group === 'board' && PINS[hp].mcu) exp[mp] = PINS[hp].mcu;
  if (x.kind === 'mission'){
    const code = exampleCode();
    for (const [a, b] of sug) addWire(a, b, null, true);
    refreshNet(); const fix = snapshot({ code }); for (const w of [...wires]) removeWire(w, true); refreshNet();
    return { board, exp, code, fix };
  }
  for (const [a, b] of sug) addWire(a, b, null, true);
  refreshNet();
  const good = exampleCode(), fix = snapshot({ code:good }), code = x.code ? x.code(good) : good;
  if (x.bug) x.bug(wireApi, { m:type => bench.modules.find(m => m.type === type) });
  refreshNet();
  return { board, exp, code, fix };
}
/** 判定用的 context。st：這一關的狀態（exp、cnt、v、flag）；rt：{ running, serial, reflashed } */
export function makeCtx(st, rt){
  const b = bench.board;
  return { b, scl:headerPin(b.i2c.scl)?.mcu, sda:headerPin(b.i2c.sda)?.mcu,
    m:type => bench.modules.find(x => x.type === type),
    exp:(m, n) => m ? st.exp[`${m.id}.${n}`] || null : null,
    label:mcu => { if (!mcu) return '（沒有）'; const h = b.header.find(x => x.mcu === mcu); return h && h.label !== mcu ? `${h.label}（${mcu}）` : mcu; },
    running:!!rt.running, serial:rt.serial || '', reflashed:!!rt.reflashed, cnt:st.cnt, v:st.v, flag:st.flag };
}
const text = (t, c) => typeof t === 'function' ? t(c) : t;
/** 一次判定：回傳 { steps:[{ text, ok }], done } */
export function evaluate(x, c){
  try { x.watch?.(c); } catch (_){ /* 模組被移除時略過 */ }
  const safe = f => { try { return !!f(c); } catch (_){ return false; } };
  const steps = x.kind === 'mission'
    ? x.steps.map(s => ({ text:text(s.t, c), ok:safe(s.ok) }))
    : [{ text:'找出問題、修好之後，重新「檢測 → 編譯 → 燒錄」', ok:c.running && c.reflashed }, { text:'確認問題解決了', ok:c.running && c.reflashed && safe(x.fixed) }];
  return { steps, done:steps.every(s => s.ok) };
}
export const hintText = (x, k, c) => { try { return text(x.hints[k], c); } catch (_){ return ''; } };
