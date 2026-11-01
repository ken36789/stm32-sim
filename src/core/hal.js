// 模擬的 STM32 HAL 函式庫。新增函式時加在 makeAPI 裡，編譯器會自動認得。
// 會等待的函式（例如 I2C 傳輸）要另外加進 compiler.js 的 ASYNC_BUILTIN。
import { SIM, readPin, i2cFind, adcRead, bench } from './sim.js';
import { cfmt } from './printf.js';
import { hooks } from './hooks.js';
import { vendorAPI, VENDOR_PREFIX } from './hal-vendor.js';

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
    const d = i2cFind((addr >>> 0) >> 1);
    if (!d || d === 'conflict') return HAL_ERROR;
    return fn(d.dev) ? HAL_OK : HAL_ERROR;
  };
  const noop = () => { chk(); return HAL_OK; };
  const api = {
    HAL_Init:noop, SystemClock_Config:noop, MX_GPIO_Init:noop, MX_I2C1_Init:noop, MX_I2C2_Init:noop, MX_I2C3_Init:noop,
    MX_USART1_UART_Init:noop, MX_USART2_UART_Init:noop, MX_USART3_UART_Init:noop, MX_LPUART1_UART_Init:noop,
    MX_ADC1_Init:noop, MX_ADC_Init:noop, MX_TIM2_Init:noop, MX_TIM3_Init:noop,
    Error_Handler(){ chk(); throw new Error('進入 Error_Handler()'); },
    async HAL_Delay(ms){
      chk(); const end = performance.now() + Math.max(0, Number(ms) || 0);
      do { await sleep(Math.max(0, Math.min(end - performance.now(), 100))); chk(); } while (performance.now() < end);
    },
    HAL_GetTick(){ chk(); return Math.floor(performance.now() - r.t0); },
    HAL_GPIO_WritePin(port, mask, st){ chk(); for (const p of pinsOf(port, mask)){ SIM.mode[p] = 'out'; SIM.out[p] = st ? 1 : 0; } hooks.outputs(); },
    HAL_GPIO_TogglePin(port, mask){ chk(); for (const p of pinsOf(port, mask)){ SIM.mode[p] = 'out'; SIM.out[p] = SIM.out[p] ? 0 : 1; } hooks.outputs(); },
    HAL_GPIO_ReadPin(port, mask){ chk(); const p = pinsOf(port, mask)[0]; if (!p) return 0; if (!SIM.mode[p]){ SIM.mode[p] = 'in'; hooks.outputs(); } return readPin(p); },
    HAL_I2C_IsDeviceReady:(h, addr) => i2c(h, addr, () => true),
    HAL_I2C_Mem_Read:(h, addr, reg, size, buf, len) => i2c(h, addr, dev => { const d = dev.read(reg, len); if (!d) return false; d.forEach((x, i) => { if (buf) buf[i] = x; }); return true; }),
    HAL_I2C_Mem_Write:(h, addr, reg, size, buf, len) => i2c(h, addr, dev => dev.write(reg, toBytes(buf, len))),
    HAL_I2C_Master_Transmit:(h, addr, buf, len) => i2c(h, addr, dev => dev.tx(toBytes(buf, len))),
    HAL_I2C_Master_Receive:(h, addr, buf, len) => i2c(h, addr, dev => { const d = dev.rx(len); if (!d) return false; d.forEach((x, i) => { if (buf) buf[i] = x; }); return true; }),
    HAL_ADC_Start(h){ chk(); return HAL_OK; },
    HAL_ADC_Stop(h){ chk(); return HAL_OK; },
    HAL_ADC_PollForConversion(h){ chk(); return HAL_OK; },
    HAL_ADC_GetValue(h){ chk(); return adcRead(); },
    HAL_UART_Transmit(h, data, len){
      chk(); let s;
      if (typeof data === 'string') s = data; else if (data && data.__str !== undefined) s = data.__str; else if (Array.isArray(data)) s = String.fromCharCode(...data.slice(0, len).filter(Boolean)); else s = String(data);
      hooks.serial(s.slice(0, len === undefined ? s.length : len)); return HAL_OK;
    },
    printf(f, ...a){ chk(); const s = cfmt(f, a); hooks.serial(s); return s.length; },
    puts(s){ chk(); hooks.serial(cfmt('%s', [s]) + '\n'); return 0; },
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
    __u8:x => (Math.trunc(Number(x) || 0)) & 0xFF, __i8:x => ((Math.trunc(Number(x) || 0)) << 24) >> 24,
    __u16:x => (Math.trunc(Number(x) || 0)) & 0xFFFF, __i16:x => ((Math.trunc(Number(x) || 0)) << 16) >> 16,
    __u32:x => (Math.trunc(Number(x) || 0)) >>> 0, __i32:x => (Math.trunc(Number(x) || 0)) | 0,
    GPIO_PIN_SET:1, GPIO_PIN_RESET:0, GPIO_PIN_All:0xFFFF, HAL_OK, HAL_ERROR, HAL_BUSY:2, HAL_TIMEOUT:3,
    hi2c1:{ name:'I2C1' }, hi2c2:{ name:'I2C2' }, hi2c3:{ name:'I2C3' },
    huart1:{ name:'USART1' }, huart2:{ name:'USART2' }, huart3:{ name:'USART3' }, hlpuart1:{ name:'LPUART1' }, hadc1:{ name:'ADC1' },
    HAL_MAX_DELAY:0xFFFFFFFF, I2C_MEMADD_SIZE_8BIT:1, I2C_MEMADD_SIZE_16BIT:2, NULL:null,
  };
  'ABCDEFGHIJK'.split('').forEach(p => api['GPIO' + p] = { port:p });
  for (let b = 0; b < 16; b++) api['GPIO_PIN_' + b] = 1 << b;
  Object.assign(api, vendorAPI({ chk, sleep, outputs:() => hooks.outputs(), print:(f, a) => { chk(); const s = cfmt(f, a); hooks.serial(s); return s.length; } }));
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
const INTERNAL = new Set(['__y', '__arr', '__u8', '__i8', '__u16', '__i16', '__u32', '__i32', '__env']);
export const BUILTIN_FNS = new Set(API_NAMES.filter(k => typeof SAMPLE_API[k] === 'function' && !INTERNAL.has(k)));
export { VENDOR_PREFIX };
export const currentBoard = () => bench.board;
