// 開發板與外接模組的腳位定義（目前為 STM32H743ZI）
export const J1 = [
  ['3V3','3.3 V 電源輸出'],['5V','5 V 電源輸出（USB）'],
  ['GND','接地'],['GND','接地'],
  ['PA0','ADC1_INP16 · TIM2_CH1'],['PA3','ADC1_INP15 · USART2_RX'],
  ['PA5','SPI1_SCK · DAC1_OUT2'],['PA6','SPI1_MISO · TIM3_CH1'],
  ['PB8','I2C1_SCL'],['PB9','I2C1_SDA'],
  ['PC6','TIM3_CH1 · USART6_TX'],['PC7','TIM3_CH2 · USART6_RX'],
  ['PD8','USART3_TX · ST-LINK 虛擬 COM'],['PD9','USART3_RX · ST-LINK 虛擬 COM'],
  ['PE9','TIM1_CH1'],['PE11','TIM1_CH2'],
  ['PF13','GPIO'],['PG9','GPIO'],
  ['GND','接地'],['3V3','3.3 V 電源輸出'],
];
export const MODS = {
  LED: { name:'LED 模組', short:'LED', pins:[['SIG','訊號：高電位點亮（內含 220 Ω）'],['GND','接地']], cx:50, cz:-21, w:20, d:14, pcb:0x1c3a57 },
  BTN: { name:'按鈕模組', short:'按鈕', pins:[['VCC','電源 3.3 V'],['OUT','輸出：按下為高電位（內含 10 kΩ 下拉）'],['GND','接地']], cx:50, cz:-1, w:20, d:19, pcb:0x22304a },
  SEN: { name:'I2C 溫度感測器', short:'感測器', pins:[['VCC','電源 1.8–3.6 V'],['GND','接地'],['SCL','I2C 時脈'],['SDA','I2C 資料']], cx:50, cz:23, w:20, d:24, pcb:0x47286a },
};
export const PINS = {}, PIN_ORDER = [];
J1.forEach(([n, f], i) => {
  const id = 'J1-' + (i + 1);
  PINS[id] = { id, name:n, func:f, group:'board', label:`J1-${i+1} ${n}`, kind: n === 'GND' ? 'gnd' : (n === '3V3' || n === '5V') ? 'pwr' : 'gpio' };
  PIN_ORDER.push(id);
});
for (const [k, m] of Object.entries(MODS)) m.pins.forEach(([n, f]) => {
  const id = k + '.' + n;
  PINS[id] = { id, name:n, func:f, group:k, label:`${m.short} ${n}`, kind:'mod' };
  PIN_ORDER.push(id);
});
export const nodeOf = id => PINS[id].group === 'board' ? PINS[id].name : id;
export const isGpioName = s => /^P[A-K]\d+$/.test(s);


export const WIRE_COLORS = { red:0xd5392e, black:0x2a2a2a, yellow:0xf0c419, blue:0x2f6cd6, green:0x2f9d55, orange:0xef7d1a, white:0xe6e6e6, purple:0x8b50d2 };
export const COLOR_NAMES = { red:'紅', black:'黑', yellow:'黃', blue:'藍', green:'綠', orange:'橙', white:'白', purple:'紫' };
export function boardPinPos(i){ const row = Math.floor(i / 2), col = i % 2; return { x: col ? 19 : 14, z: -22.5 + row * 5 }; }
export function modPinPos(key, j){ const m = MODS[key], n = m.pins.length; return { x: m.cx - m.w / 2 + 3, z: m.cz + (j - (n - 1) / 2) * 5 }; }
export function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const hex6 = n => '#' + n.toString(16).padStart(6, '0');

// 範例接線：SAMPLE 故意把 SCL/SDA 接反，FULL 是完整正確的接線
export const SAMPLE = [['J1-7','LED.SIG'],['J1-3','LED.GND'],['J1-1','SEN.VCC'],['J1-4','SEN.GND'],['J1-10','SEN.SCL'],['J1-9','SEN.SDA']];
export const FULL = [['J1-7','LED.SIG'],['J1-3','LED.GND'],['J1-1','SEN.VCC'],['J1-4','SEN.GND'],['J1-9','SEN.SCL'],['J1-10','SEN.SDA'],['J1-20','BTN.VCC'],['J1-19','BTN.GND'],['J1-5','BTN.OUT']];
