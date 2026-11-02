// 模擬的 STM32 HAL 函式庫。新增函式時加在 makeAPI 裡，編譯器會自動認得。
// 會等待的函式（例如 I2C 傳輸）要另外加進 compiler.js 的 ASYNC_BUILTIN。
import { SIM, readPin, adcRead, bench, pinWrite, pinToggle } from './sim.js';
import { cfmt } from './printf.js';
import { hooks } from './hooks.js';
import { vendorAPI, VENDOR_PREFIX } from './hal-vendor.js';
import { i2cWrite, i2cRead, i2cMemRead, i2cMemWrite, i2cProbe, uartOut, spiTransfer, CAN, canSend, canPending, canRecv } from './buses.js';
import { stepIndexes, pwmSet, pwmRun } from './steppers.js';

export const STOP = { stop:true };
const HAL_OK = 0, HAL_ERROR = 1;
const toBytes = (buf, len) => typeof buf === 'number' ? [buf & 0xFF] : Array.from({ length:len }, (_, i) => (buf?.[i] ?? 0) & 0xFF);

export function makeAPI(r){
  const chk = () => { if (r.stop) throw STOP; };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let yc = 0;
  const pinsOf = (port, mask) => { const o = []; if (!port || !port.port) return o; for (let b = 0; b < 16; b++) if ((mask >>> 0) & (1 << b)) o.push('P' + port.port + b); return o; };
  const i2c = async (h, addr, fn) => {
    chk(); await sleep(1); chk();
    if (!h || h.name !== 'I2C1') return HAL_ERROR;      // 模擬器只接了 I2C1
    return fn((addr >>> 0) >> 1) ? HAL_OK : HAL_ERROR;
  };
  const fill = (buf, d) => { if (!d) return false; d.forEach((x, i) => { if (buf) buf[i] = x; }); return true; };
  const spiOk = h => !h || !h.name || !bench.board.spi || h.name === bench.board.spi.inst;
  const fdLen = x => { x = Number(x) || 0; if (x > 15) x = x >>> 16; return Math.min(8, x); };
  const canOk = h => h && /CAN/.test(h.name || '');
  // 計時器 PWM（STEP 脈波）：範例的 MX_TIMx_Init 把計時器時脈預除頻到 1 MHz，頻率 = 1 MHz ÷ (ARR + 1)
  const tims = {}, timOf = h => tims[h?.name] || (tims[h?.name] = { arr:999, run:{}, ccr:{} }), chOf = c => (Number(c) || 0) / 4 + 1;
  const timApply = h => {
    const t = timOf(h);
    for (const k of stepIndexes(h?.name)){
      const ch = bench.board.step[k].ch;
      pwmSet(k, 1e6 / (t.arr + 1)); pwmRun(k, !!t.run[ch] && (t.ccr[ch] ?? 1) > 0);
    }
  };
  const noop = () => { chk(); return HAL_OK; };
  // 延遲：在 MCU 上，延遲之間的程式只要幾微秒，所以「工作＋延遲 10 ms」的迴圈就是 10 ms 一次。
  // 模擬器執行程式、瀏覽器計時器晚醒都會花掉時間，所以延遲從「上一次延遲應該結束的時間」起算（落後 50 ms 內），
  // 平均週期就和真的 MCU 一樣；韌體用固定 dt 算的位置和加減速才會和實際送出的脈波一致。
  const waitMs = async ms => {
    chk(); ms = Math.max(0, Number(ms) || 0);
    const now = performance.now(), lag = r.vend !== undefined ? now - r.vend : Infinity;
    const end = (lag >= 0 && lag < 50 ? r.vend : now) + ms;
    do { await sleep(Math.max(0, Math.min(end - performance.now(), 100))); chk(); } while (performance.now() < end);
    r.vend = end;
  };
  const api = {
    HAL_Init:noop, SystemClock_Config:noop, MX_GPIO_Init:noop, MX_I2C1_Init:noop, MX_I2C2_Init:noop, MX_I2C3_Init:noop,
    MX_USART1_UART_Init:noop, MX_USART2_UART_Init:noop, MX_USART3_UART_Init:noop, MX_LPUART1_UART_Init:noop,
    MX_ADC1_Init:noop, MX_ADC_Init:noop, MX_TIM2_Init:noop, MX_TIM3_Init:noop, MX_SPI1_Init:noop, MX_SPI2_Init:noop, MX_SPI3_Init:noop,
    MX_CAN_Init:noop, MX_CAN1_Init:noop, MX_CAN2_Init:noop, MX_FDCAN1_Init:noop, MX_FDCAN2_Init:noop,
    Error_Handler(){ chk(); throw new Error('進入 Error_Handler()'); },
    HAL_Delay:ms => waitMs(ms),
    HAL_GetTick(){ chk(); return Math.floor(performance.now() - r.t0); },
    HAL_GPIO_WritePin(port, mask, st){ chk(); for (const p of pinsOf(port, mask)) pinWrite(p, st); hooks.outputs(); },
    HAL_GPIO_TogglePin(port, mask){ chk(); for (const p of pinsOf(port, mask)) pinToggle(p); hooks.outputs(); },
    HAL_GPIO_ReadPin(port, mask){ chk(); const p = pinsOf(port, mask)[0]; if (!p) return 0; if (!SIM.mode[p]){ SIM.mode[p] = 'in'; hooks.outputs(); } return readPin(p); },
    HAL_I2C_IsDeviceReady:(h, addr) => i2c(h, addr, a => i2cProbe(a)),
    HAL_I2C_Mem_Read:(h, addr, reg, size, buf, len) => i2c(h, addr, a => fill(buf, i2cMemRead(a, reg, len))),
    HAL_I2C_Mem_Write:(h, addr, reg, size, buf, len) => i2c(h, addr, a => i2cMemWrite(a, reg, toBytes(buf, len))),
    HAL_I2C_Master_Transmit:(h, addr, buf, len) => i2c(h, addr, a => i2cWrite(a, toBytes(buf, len))),
    HAL_I2C_Master_Receive:(h, addr, buf, len) => i2c(h, addr, a => fill(buf, i2cRead(a, len))),
    HAL_SPI_TransmitReceive(h, tx, rx, n){ chk(); if (!spiOk(h)) return HAL_ERROR; fill(rx, spiTransfer(toBytes(tx, n))); return HAL_OK; },
    HAL_SPI_Transmit(h, tx, n){ chk(); if (!spiOk(h)) return HAL_ERROR; spiTransfer(toBytes(tx, n)); return HAL_OK; },
    HAL_SPI_Receive(h, rx, n){ chk(); if (!spiOk(h)) return HAL_ERROR; fill(rx, spiTransfer(Array(Math.max(0, n)).fill(0xFF))); return HAL_OK; },
    HAL_TIM_PWM_Start(h, c){ chk(); if (!h?.name) return HAL_ERROR; timOf(h).run[chOf(c)] = true; timApply(h); return HAL_OK; },
    HAL_TIM_PWM_Stop(h, c){ chk(); if (!h?.name) return HAL_ERROR; timOf(h).run[chOf(c)] = false; timApply(h); return HAL_OK; },
    __HAL_TIM_SET_AUTORELOAD(h, v){ chk(); timOf(h).arr = Math.max(0, Math.trunc(Number(v) || 0)) >>> 0; timApply(h); },
    __HAL_TIM_GET_AUTORELOAD(h){ chk(); return timOf(h).arr; },
    __HAL_TIM_SET_COMPARE(h, c, v){ chk(); timOf(h).ccr[chOf(c)] = Math.trunc(Number(v) || 0) >>> 0; timApply(h); },
    __HAL_TIM_SET_COUNTER(){ chk(); },
    TIM_CHANNEL_1:0, TIM_CHANNEL_2:4, TIM_CHANNEL_3:8, TIM_CHANNEL_4:12,
    HAL_CAN_ConfigFilter(){ chk(); return HAL_OK; },
    HAL_CAN_Start(h){ chk(); if (canOk(h)) CAN.started = true; return HAL_OK; },
    HAL_CAN_Stop(){ chk(); CAN.started = false; return HAL_OK; },
    HAL_CAN_AddTxMessage(h, hdr, data){ chk(); if (!CAN.started || !hdr) return HAL_ERROR; canSend(hdr.StdId, toBytes(data, Math.min(8, Number(hdr.DLC) || 0))); return HAL_OK; },
    HAL_CAN_GetTxMailboxesFreeLevel(){ chk(); return 3; },
    HAL_CAN_GetRxFifoFillLevel(){ chk(); return canPending(); },
    HAL_CAN_GetRxMessage(h, f, hdr, data){ chk(); const fr = canRecv(); if (!fr) return HAL_ERROR; if (hdr){ hdr.StdId = fr.id; hdr.DLC = fr.data.length; hdr.IDE = 0; hdr.RTR = 0; } fill(data, fr.data); return HAL_OK; },
    HAL_CAN_GetError(){ chk(); return CAN.txErr ? 0x00000400 : 0; },
    HAL_FDCAN_ConfigFilter(){ chk(); return HAL_OK; }, HAL_FDCAN_ConfigGlobalFilter(){ chk(); return HAL_OK; },
    HAL_FDCAN_Start(h){ chk(); if (canOk(h)) CAN.started = true; return HAL_OK; },
    HAL_FDCAN_Stop(){ chk(); CAN.started = false; return HAL_OK; },
    HAL_FDCAN_AddMessageToTxFifoQ(h, hdr, data){ chk(); if (!CAN.started || !hdr) return HAL_ERROR; canSend(hdr.Identifier, toBytes(data, fdLen(hdr.DataLength))); return HAL_OK; },
    HAL_FDCAN_GetRxFifoFillLevel(){ chk(); return canPending(); },
    HAL_FDCAN_GetRxMessage(h, f, hdr, data){ chk(); const fr = canRecv(); if (!fr) return HAL_ERROR; if (hdr){ hdr.Identifier = fr.id; hdr.DataLength = fr.data.length; hdr.IdType = 0; } fill(data, fr.data); return HAL_OK; },
    HAL_ADC_Start(h){ chk(); return HAL_OK; },
    HAL_ADC_Stop(h){ chk(); return HAL_OK; },
    HAL_ADC_PollForConversion(h){ chk(); return HAL_OK; },
    HAL_ADC_GetValue(h){ chk(); return adcRead(); },
    HAL_UART_Transmit(h, data, len){
      chk(); let s;
      if (typeof data === 'string') s = data; else if (data && data.__str !== undefined) s = data.__str; else if (Array.isArray(data)) s = String.fromCharCode(...data.slice(0, len).filter(Boolean)); else s = String(data);
      uartOut(s.slice(0, len === undefined ? s.length : len)); return HAL_OK;
    },
    printf(f, ...a){ chk(); const s = cfmt(f, a); uartOut(s); return s.length; },
    puts(s){ chk(); uartOut(cfmt('%s', [s]) + '\n'); return 0; },
    sprintf(buf, f, ...a){ chk(); const s = cfmt(f, a); if (buf && typeof buf === 'object'){ buf.__str = s; for (let k = 0; k < s.length && k < buf.length; k++) buf[k] = s.charCodeAt(k); } return s.length; },
    strlen(s){ return s && s.__str !== undefined ? s.__str.length : String(s).length; },
    abs:Math.abs, fabs:Math.abs, sqrt:Math.sqrt, sqrtf:Math.sqrt,
    async __y(){ chk(); if (++yc % 2000 === 0){ await sleep(0); chk(); } },
    __arr(n, init){
      const a = new Array(Math.max(0, Number(n) || 0)).fill(0);
      if (typeof init === 'string'){ a.__str = init; for (let k = 0; k < init.length && k < a.length; k++) a[k] = init.charCodeAt(k); }
      else if (Array.isArray(init)) init.forEach((v, k) => { if (k < a.length || !n) a[k] = v; });
      return a;
    },
    // 結構變數：沒有設定過的欄位讀到 0；data／buf 這類欄位自動變成陣列，Config 結尾的欄位是巢狀結構
    __obj(){ const P = () => new Proxy({}, { get(t, k){ if (typeof k !== 'string' || k in t || k.startsWith('__') || k === 'then' || k === 'toJSON') return t[k]; if (/data|Data|buf|Buf/.test(k)) return (t[k] = []); if (/[Cc]onfig$|[Cc]fg$/.test(k)) return (t[k] = P()); return 0; } }); return P(); },
    __u8:x => (Math.trunc(Number(x) || 0)) & 0xFF, __i8:x => ((Math.trunc(Number(x) || 0)) << 24) >> 24,
    __u16:x => (Math.trunc(Number(x) || 0)) & 0xFFFF, __i16:x => ((Math.trunc(Number(x) || 0)) << 16) >> 16,
    __u32:x => (Math.trunc(Number(x) || 0)) >>> 0, __i32:x => (Math.trunc(Number(x) || 0)) | 0,
    GPIO_PIN_SET:1, GPIO_PIN_RESET:0, GPIO_PIN_All:0xFFFF, HAL_OK, HAL_ERROR, HAL_BUSY:2, HAL_TIMEOUT:3,
    hi2c1:{ name:'I2C1' }, hi2c2:{ name:'I2C2' }, hi2c3:{ name:'I2C3' }, hspi1:{ name:'SPI1' }, hspi2:{ name:'SPI2' }, hspi3:{ name:'SPI3' },
    hcan:{ name:'CAN1' }, hcan1:{ name:'CAN1' }, hcan2:{ name:'CAN2' }, hfdcan1:{ name:'FDCAN1' }, hfdcan2:{ name:'FDCAN2' },
    CAN_ID_STD:0, CAN_ID_EXT:4, CAN_RTR_DATA:0, CAN_RTR_REMOTE:2, CAN_RX_FIFO0:0, CAN_RX_FIFO1:1, CAN_FILTERMODE_IDMASK:0, CAN_FILTERSCALE_32BIT:1, CAN_FILTER_FIFO0:0, ENABLE:1, DISABLE:0,
    FDCAN_STANDARD_ID:0, FDCAN_EXTENDED_ID:0x40000000, FDCAN_DATA_FRAME:0, FDCAN_ESI_ACTIVE:0, FDCAN_BRS_OFF:0, FDCAN_CLASSIC_CAN:0, FDCAN_NO_TX_EVENTS:0, FDCAN_RX_FIFO0:0x40,
    FDCAN_ACCEPT_IN_RX_FIFO0:0, FDCAN_REJECT_REMOTE:1, FDCAN_FILTER_REMOTE:0,
    huart1:{ name:'USART1' }, huart2:{ name:'USART2' }, huart3:{ name:'USART3' }, hlpuart1:{ name:'LPUART1' }, hadc1:{ name:'ADC1' },
    HAL_MAX_DELAY:0xFFFFFFFF, I2C_MEMADD_SIZE_8BIT:1, I2C_MEMADD_SIZE_16BIT:2, NULL:null,
  };
  'ABCDEFGHIJK'.split('').forEach(p => api['GPIO' + p] = { port:p });
  for (let b = 0; b < 16; b++) api['GPIO_PIN_' + b] = 1 << b;
  for (let n = 0; n <= 8; n++) api['FDCAN_DLC_BYTES_' + n] = n;
  for (let n = 1; n <= 22; n++){ api['htim' + n] = { name:'TIM' + n }; api[`MX_TIM${n}_Init`] = noop; }
  Object.assign(api, vendorAPI({ chk, sleep, waitMs, outputs:() => hooks.outputs(), print:(f, a) => { chk(); const s = cfmt(f, a); uartOut(s); return s.length; } }));
  // 未實作的 SDK 函式與巨集：函式略過並回傳 0，全大寫或 k 開頭的常數視為 0（透過 with 區塊查找）
  const known = new Set(Object.keys(api));
  const stub = () => 0;
  api.__env = new Proxy({}, {
    has:(t, k) => typeof k === 'string' && !known.has(k) && (VENDOR_PREFIX.test(k) || /^[A-Z][A-Z0-9_]*$/.test(k) || /^k[A-Z]\w*$/.test(k)),
    get:(t, k) => typeof k === 'string' && VENDOR_PREFIX.test(k) && !/^[A-Z][A-Z0-9_]*$/.test(k) ? stub : 0,
    set:() => true,
  });
  return api;
}
export const API_NAMES = Object.keys(makeAPI({ stop:false, t0:0 }));
const SAMPLE_API = makeAPI({ stop:false, t0:0 });
const INTERNAL = new Set(['__y', '__arr', '__obj', '__u8', '__i8', '__u16', '__i16', '__u32', '__i32', '__env']);
export const BUILTIN_FNS = new Set(API_NAMES.filter(k => typeof SAMPLE_API[k] === 'function' && !INTERNAL.has(k)));
export { VENDOR_PREFIX };
export const currentBoard = () => bench.board;
