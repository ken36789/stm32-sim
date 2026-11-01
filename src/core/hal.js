// 模擬的 STM32 HAL 函式庫。新增函式時加在 makeAPI 裡，編譯器會自動認得。
import { SIM, readPin, i2cState, senReg } from './sim.js';
import { cfmt } from './printf.js';
import { hooks } from './hooks.js';

export const STOP = { stop:true };

export function makeAPI(r){
  const chk = () => { if (r.stop) throw STOP; };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let yc = 0;
  const pinsOf = (port, mask) => { const o = []; if (!port || !port.port) return o; for (let b = 0; b < 16; b++) if ((mask >>> 0) & (1 << b)) o.push('P' + port.port + b); return o; };
  const api = {
    HAL_Init(){ chk(); return 0; }, SystemClock_Config(){ chk(); }, MX_GPIO_Init(){ chk(); }, MX_I2C1_Init(){ chk(); }, MX_USART3_UART_Init(){ chk(); },
    Error_Handler(){ chk(); throw new Error('進入 Error_Handler()'); },
    async HAL_Delay(ms){
      chk(); const end = performance.now() + Math.max(0, Number(ms) || 0);
      do { await sleep(Math.max(0, Math.min(end - performance.now(), 100))); chk(); } while (performance.now() < end);
    },
    HAL_GetTick(){ chk(); return Math.floor(performance.now() - r.t0); },
    HAL_GPIO_WritePin(port, mask, st){ chk(); for (const p of pinsOf(port, mask)){ SIM.mode[p] = 'out'; SIM.out[p] = st ? 1 : 0; } hooks.outputs(); },
    HAL_GPIO_TogglePin(port, mask){ chk(); for (const p of pinsOf(port, mask)){ SIM.mode[p] = 'out'; SIM.out[p] = SIM.out[p] ? 0 : 1; } hooks.outputs(); },
    HAL_GPIO_ReadPin(port, mask){ chk(); const p = pinsOf(port, mask)[0]; if (!p) return 0; if (!SIM.mode[p]){ SIM.mode[p] = 'in'; hooks.outputs(); } return readPin(p); },
    async HAL_I2C_Mem_Read(h, addr, reg, size, buf, len){
      chk(); await sleep(1); chk();
      if (!i2cState().ok || ((addr >>> 0) >> 1) !== 0x76) return 1;
      for (let k = 0; k < (len || 0); k++) if (buf) buf[k] = senReg(reg + k);
      return 0;
    },
    async HAL_I2C_IsDeviceReady(h, addr){ chk(); await sleep(1); chk(); return i2cState().ok && ((addr >>> 0) >> 1) === 0x76 ? 0 : 1; },
    HAL_UART_Transmit(h, data, len){
      chk(); let s;
      if (typeof data === 'string') s = data; else if (data && data.__str !== undefined) s = data.__str; else if (Array.isArray(data)) s = String.fromCharCode(...data.slice(0, len).filter(Boolean)); else s = String(data);
      hooks.serial(s.slice(0, len === undefined ? s.length : len)); return 0;
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
    GPIO_PIN_SET:1, GPIO_PIN_RESET:0, GPIO_PIN_All:0xFFFF, HAL_OK:0, HAL_ERROR:1, HAL_BUSY:2, HAL_TIMEOUT:3,
    hi2c1:{ name:'I2C1' }, huart3:{ name:'USART3' }, HAL_MAX_DELAY:0xFFFFFFFF, I2C_MEMADD_SIZE_8BIT:1, I2C_MEMADD_SIZE_16BIT:2, NULL:null,
  };
  'ABCDEFGHIJK'.split('').forEach(p => api['GPIO' + p] = { port:p });
  for (let b = 0; b < 16; b++) api['GPIO_PIN_' + b] = 1 << b;
  return api;
}
export const API_NAMES = Object.keys(makeAPI({ stop:false, t0:0 }));
export const BUILTIN_FNS = new Set(API_NAMES.filter(k => /^(HAL_|MX_|System|Error|printf|puts|sprintf|strlen|abs|fabs|sqrt)/.test(k) && !/^HAL_(OK|ERROR|BUSY|TIMEOUT|MAX_DELAY)$/.test(k)));
