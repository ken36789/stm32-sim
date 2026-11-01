// 外接模組與可更換的元件型號。
// grade：1 入門、2 進階、3 高階；better：比上一級好在哪裡（顯示為升級建議）。

const g = q => `https://www.google.com/search?q=${encodeURIComponent(q + ' datasheet pdf')}`;
const ds = (label, url) => ({ label, url });

export const MODULE_TYPES = {
  led: {
    name:'LED 模組', short:'LED', w:20, d:14, pcb:0x1c3a57,
    pins:[['SIG', '訊號：高電位點亮（內含限流電阻）'], ['GND', '接地']],
    variants:[
      { id:'led-red', name:'紅色 5 mm LED', part:'WP7113SRC/D', grade:1, color:0xff2a1a, specs:[['顏色', '紅 · 640 nm'], ['順向電壓', '1.85 V'], ['亮度', '400 mcd @ 10 mA']], links:[ds('Kingbright 規格書', 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113SRC-D.pdf')] },
      { id:'led-green', name:'綠色 5 mm LED', part:'WP7113GD', grade:1, color:0x2fe36b, specs:[['顏色', '綠 · 568 nm'], ['順向電壓', '2.2 V'], ['亮度', '30 mcd @ 10 mA']], links:[ds('搜尋 Datasheet', g('Kingbright WP7113GD'))] },
      { id:'led-yellow', name:'黃色 5 mm LED', part:'WP7113YD', grade:1, color:0xffc21a, specs:[['顏色', '黃 · 590 nm'], ['順向電壓', '2.1 V']], links:[ds('搜尋 Datasheet', g('Kingbright WP7113YD'))] },
      { id:'led-blue', name:'藍色高亮 LED', part:'WP7113QBC/D', grade:2, color:0x3d7bff, better:'更亮，適合當狀態指示燈', specs:[['顏色', '藍 · 465 nm'], ['順向電壓', '3.3 V'], ['亮度', '1500 mcd @ 20 mA']], links:[ds('搜尋 Datasheet', g('Kingbright WP7113QBC/D'))] },
      { id:'led-white', name:'白色超高亮 LED', part:'C503D-WAN', grade:3, color:0xf4f7ff, better:'亮度最高，可當照明用', specs:[['色溫', '6500 K'], ['順向電壓', '3.2 V'], ['亮度', '18000 mcd @ 20 mA']], links:[ds('搜尋 Datasheet', g('Cree C503D-WAN'))] },
    ],
  },
  rgb: {
    name:'RGB LED 模組', short:'RGB', w:20, d:24, pcb:0x1c3a57,
    pins:[['R', '紅色通道'], ['G', '綠色通道'], ['B', '藍色通道'], ['GND', '共陰極']],
    variants:[
      { id:'rgb-cc', name:'5 mm 共陰極 RGB LED', part:'YSL-R596CR3G4B5C-C10', grade:1, specs:[['類型', '共陰極'], ['控制', '3 支 GPIO，高電位點亮']], links:[ds('搜尋 Datasheet', g('YSL-R596CR3G4B5C-C10'))] },
      { id:'rgb-smd', name:'SMD 5050 RGB LED', part:'PLCC-6 5050', grade:2, better:'亮度更高、散熱較好', specs:[['類型', '共陰極'], ['亮度', '每色約 600–1500 mcd']], links:[ds('搜尋 Datasheet', g('5050 RGB LED PLCC6'))] },
    ],
  },
  button: {
    name:'按鈕模組', short:'按鈕', w:20, d:19, pcb:0x22304a,
    pins:[['VCC', '電源 3.3 V'], ['OUT', '輸出：按下為高電位（內含 10 kΩ 下拉）'], ['GND', '接地']],
    variants:[
      { id:'btn-tact', name:'6×6 mm 輕觸按鈕', part:'Omron B3F-1000', grade:1, kind:'tact', specs:[['壽命', '100 萬次'], ['彈跳時間', '約 5 ms，程式需要去彈跳']], links:[ds('Omron B3F 規格書', 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf')] },
      { id:'btn-touch', name:'電容觸控按鍵', part:'TTP223', grade:2, kind:'touch', better:'沒有機械彈跳、可隔著壓克力觸控', specs:[['工作電壓', '2.0–5.5 V'], ['輸出', '觸碰時高電位'], ['反應時間', '約 60 ms']], links:[ds('搜尋 Datasheet', g('TTP223 touch'))] },
    ],
  },
  pir: {
    name:'人體紅外線感應', short:'PIR', w:22, d:19, pcb:0x2c6e3a,
    pins:[['VCC', '電源（依型號）'], ['OUT', '偵測到人時輸出高電位'], ['GND', '接地']],
    variants:[
      { id:'pir-sr501', name:'HC-SR501', part:'HC-SR501（BISS0001）', grade:1, vmin:4.5, hold:3, specs:[['工作電壓', '4.5–20 V（需接 5V）'], ['輸出', '3.3 V 高電位'], ['偵測距離', '3–7 m，可調'], ['延遲', '約 2.5 秒以上，可調']], links:[ds('搜尋 Datasheet', g('HC-SR501 PIR'))] },
      { id:'pir-am312', name:'AM312 迷你 PIR', part:'AM312', grade:2, vmin:2.7, hold:2, better:'可直接接 3.3 V、體積小、待機電流低', specs:[['工作電壓', '2.7–12 V'], ['輸出', '高電位'], ['偵測距離', '3–5 m'], ['延遲', '約 2 秒']], links:[ds('搜尋 Datasheet', g('AM312 PIR'))] },
    ],
  },
  pot: {
    name:'類比輸入模組', short:'類比', w:20, d:19, pcb:0x3b2f22,
    pins:[['VCC', '電源 3.3 V'], ['OUT', '類比電壓輸出（接 ADC 腳）'], ['GND', '接地']],
    variants:[
      { id:'pot-rotary', name:'10 kΩ 旋轉電位器', part:'Bourns PTV09A', grade:1, kind:'knob', specs:[['阻值', '10 kΩ ±20%'], ['旋轉角度', '300°'], ['輸出', '0 V～VCC']], links:[ds('Bourns PTV09 規格書', 'https://www.bourns.com/docs/Product-Datasheets/PTV09.pdf')] },
      { id:'pot-slide', name:'10 kΩ 滑動電位器', part:'Bourns PTA2043', grade:2, kind:'slide', better:'行程長、刻度直觀，適合調整音量或亮度', specs:[['阻值', '10 kΩ 線性'], ['行程', '20 mm']], links:[ds('搜尋 Datasheet', g('Bourns PTA2043'))] },
      { id:'pot-ldr', name:'光敏電阻', part:'GL5528', grade:1, kind:'ldr', specs:[['亮阻', '10–20 kΩ（10 lux）'], ['暗阻', '1 MΩ'], ['用途', '偵測環境光']], links:[ds('搜尋 Datasheet', g('GL5528 photoresistor'))] },
    ],
  },
  temp: {
    name:'I2C 溫度感測器', short:'感測器', w:20, d:24, pcb:0x47286a,
    pins:[['VCC', '電源（依型號）'], ['GND', '接地'], ['SCL', 'I2C 時脈'], ['SDA', 'I2C 資料']],
    variants:[
      { id:'lm75a', name:'LM75A 溫度感測器', part:'NXP LM75A', grade:1, addr:0x48, dev:'lm75', bias:1.1, noise:.25, vmax:5.5, specs:[['精度', '±2 °C'], ['解析度', '0.125 °C（11 位元）'], ['I2C 位址', '0x48'], ['工作電壓', '2.8–5.5 V']], links:[ds('NXP LM75A Datasheet（PDF）', 'https://www.nxp.com/docs/en/data-sheet/LM75A.pdf')] },
      { id:'tmp102', name:'TMP102 數位溫度計', part:'TI TMP102', grade:2, addr:0x48, dev:'tmp102', bias:.3, noise:.06, vmax:3.6, better:'精度從 ±2 °C 提升到 ±0.5 °C、功耗更低', specs:[['精度', '±0.5 °C'], ['解析度', '0.0625 °C（12 位元）'], ['I2C 位址', '0x48'], ['工作電壓', '1.4–3.6 V']], links:[ds('TI TMP102 Datasheet（PDF）', 'https://www.ti.com/lit/ds/symlink/tmp102.pdf')] },
      { id:'mcp9808', name:'MCP9808 高精度溫度計', part:'Microchip MCP9808', grade:3, addr:0x18, dev:'mcp9808', bias:.1, noise:.03, vmax:5.5, better:'典型精度 ±0.25 °C，適合精密量測', specs:[['精度', '±0.25 °C（典型）'], ['解析度', '0.0625 °C'], ['I2C 位址', '0x18'], ['工作電壓', '2.7–5.5 V']], links:[ds('MCP9808 Datasheet（PDF）', 'https://ww1.microchip.com/downloads/en/DeviceDoc/25095A.pdf')] },
      { id:'bmp280', name:'BMP280 溫度／氣壓', part:'Bosch BMP280', grade:2, addr:0x76, dev:'bmx280', chipId:0x58, bias:.4, noise:.05, vmax:3.6, specs:[['溫度精度', '±1 °C'], ['氣壓', '300–1100 hPa'], ['I2C 位址', '0x76'], ['晶片 ID', '0x58'], ['工作電壓', '1.71–3.6 V']], links:[ds('BMP280 Datasheet（PDF）', 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf')] },
      { id:'bme280', name:'BME280 溫溼度／氣壓', part:'Bosch BME280', grade:3, addr:0x76, dev:'bmx280', chipId:0x60, bias:.3, noise:.05, vmax:3.6, better:'在 BMP280 的基礎上多了溼度量測', specs:[['溫度精度', '±1 °C'], ['溼度精度', '±3 %RH'], ['I2C 位址', '0x76'], ['晶片 ID', '0x60'], ['工作電壓', '1.71–3.6 V']], links:[ds('BME280 Datasheet（PDF）', 'https://cdn.sparkfun.com/assets/5/3/0/f/7/BME280_Datasheet.pdf'), ds('Bosch 產品頁', 'https://www.bosch-sensortec.com/products/environmental-sensors/humidity-sensors-bme280/')] },
      { id:'aht20', name:'AHT20 溫溼度感測器', part:'Aosong AHT20', grade:2, addr:0x38, dev:'aht20', bias:.25, noise:.04, vmax:5.5, better:'便宜的溫溼度二合一', specs:[['溫度精度', '±0.3 °C'], ['溼度精度', '±2 %RH'], ['I2C 位址', '0x38'], ['工作電壓', '2.0–5.5 V']], links:[ds('搜尋 Datasheet', g('AHT20 Aosong'))] },
      { id:'hdc1080', name:'HDC1080 溫溼度感測器', part:'TI HDC1080', grade:2, addr:0x40, dev:'hdc1080', bias:.15, noise:.04, vmax:5.5, better:'溼度精度 ±2 %RH、超低功耗', specs:[['溫度精度', '±0.2 °C'], ['溼度精度', '±2 %RH'], ['I2C 位址', '0x40'], ['工作電壓', '2.7–5.5 V']], links:[ds('TI HDC1080 Datasheet（PDF）', 'https://www.ti.com/lit/ds/symlink/hdc1080.pdf')] },
      { id:'sht31', name:'SHT31 高精度溫溼度', part:'Sensirion SHT31-DIS', grade:3, addr:0x44, dev:'sht3x', bias:.05, noise:.02, vmax:5.5, better:'溫度 ±0.2 °C、溼度 ±2 %RH，工業級穩定度', specs:[['溫度精度', '±0.2 °C'], ['溼度精度', '±2 %RH'], ['I2C 位址', '0x44'], ['工作電壓', '2.15–5.5 V']], links:[ds('Sensirion 產品頁', 'https://sensirion.com/products/catalog/SHT31-DIS-B'), ds('搜尋 Datasheet', g('Sensirion SHT3x-DIS'))] },
    ],
  },
  buzzer: {
    name:'有源蜂鳴器', short:'蜂鳴器', w:20, d:14, pcb:0x1d1f22,
    pins:[['SIG', '高電位發聲'], ['GND', '接地']],
    variants:[
      { id:'buz-12', name:'12 mm 有源蜂鳴器', part:'TMB12A05', grade:1, specs:[['工作電壓', '3.5–5.5 V（3.3 V 音量較小）'], ['頻率', '2.3 kHz'], ['音壓', '85 dB']], links:[ds('搜尋 Datasheet', g('TMB12A05 buzzer'))] },
      { id:'buz-3v', name:'3 V 低電壓有源蜂鳴器', part:'TMB12A03', grade:2, better:'3.3 V 驅動也有足夠音量', specs:[['工作電壓', '2–4 V'], ['頻率', '2.3 kHz'], ['音壓', '85 dB']], links:[ds('搜尋 Datasheet', g('TMB12A03 buzzer'))] },
    ],
  },
  relay: {
    name:'繼電器模組', short:'繼電器', w:24, d:19, pcb:0x1d3d6b,
    pins:[['VCC', '線圈電源（依型號）'], ['IN', '高電位吸合'], ['GND', '接地']],
    variants:[
      { id:'relay-5v', name:'5 V 繼電器模組', part:'Songle SRD-05VDC-SL-C', grade:1, vmin:4.5, specs:[['線圈電壓', '5 V（接 3V3 會吸不動）'], ['接點', '10 A 250 VAC'], ['觸發', 'IN 高電位']], links:[ds('搜尋 Datasheet', g('SRD-05VDC-SL-C'))] },
      { id:'relay-3v', name:'3 V 繼電器模組', part:'Songle SRD-03VDC-SL-C', grade:2, vmin:2.7, better:'可直接用 3.3 V 驅動，不需要 5V', specs:[['線圈電壓', '3 V'], ['接點', '10 A 250 VAC'], ['觸發', 'IN 高電位']], links:[ds('搜尋 Datasheet', g('SRD-03VDC-SL-C'))] },
      { id:'relay-ssr', name:'固態繼電器模組', part:'Omron G3MB-202P', grade:3, vmin:4.5, better:'無機械接點、靜音、壽命長（只能切換交流負載）', specs:[['輸入', '5 V'], ['負載', '2 A 100–240 VAC'], ['觸發', 'IN 高電位']], links:[ds('搜尋 Datasheet', g('Omron G3MB-202P'))] },
    ],
  },
};

export const TYPE_ORDER = ['led', 'rgb', 'button', 'pir', 'pot', 'temp', 'buzzer', 'relay'];
export const variantOf = (type, vid) => MODULE_TYPES[type].variants.find(v => v.id === vid) || MODULE_TYPES[type].variants[0];
export const MAX_MODULES = 8;
export const DEFAULT_MODULES = [
  { type:'led', variant:'led-red' },
  { type:'button', variant:'btn-tact' },
  { type:'temp', variant:'bme280' },
  { type:'pot', variant:'pot-rotary' },
  { type:'buzzer', variant:'buz-3v' },
];

/* ---------- 麵包板電源軌 ---------- */
export const RAIL_HOLES = 10;
