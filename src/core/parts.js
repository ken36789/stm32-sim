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
  tc: {
    name:'SPI 熱電偶模組', short:'熱電偶', w:22, d:28, pcb:0xa3262a, bus:'spi',
    pins:[['VCC', '電源（依型號）'], ['GND', '接地'], ['SCK', 'SPI 時脈（接 MCU 的 SCK）'], ['CS', '片選：低電位時被選中（接一支 GPIO）'], ['SO', '資料輸出（接 MCU 的 MISO）']],
    variants:[
      { id:'max6675', name:'MAX6675 K 型熱電偶模組', part:'Maxim MAX6675', grade:1, dev:'max6675', vmin:3.0, vmax:5.5, specs:[['量測範圍', '0–1024 °C'], ['解析度', '0.25 °C（12 位元）'], ['介面', 'SPI 唯讀，一次 16 位元'], ['SPI 時脈', '最高 4.3 MHz'], ['工作電壓', '3.0–5.5 V']], links:[ds('MAX6675 Datasheet（PDF）', 'https://www.analog.com/media/en/technical-documentation/data-sheets/MAX6675.pdf')] },
      { id:'max31855', name:'MAX31855K 熱電偶模組', part:'Maxim MAX31855K', grade:2, dev:'max31855', vmin:3.0, vmax:3.6, better:'可以量負溫度，還有冷接點溫度與斷線故障旗標', specs:[['量測範圍', '−200–1350 °C'], ['解析度', '0.25 °C（14 位元）'], ['介面', 'SPI 唯讀，一次 32 位元'], ['SPI 時脈', '最高 5 MHz'], ['工作電壓', '3.0–3.6 V']], links:[ds('MAX31855 Datasheet（PDF）', 'https://www.analog.com/media/en/technical-documentation/data-sheets/MAX31855.pdf')] },
    ],
  },
  flash: {
    name:'SPI Flash 記憶體', short:'Flash', w:22, d:28, pitch:4, pcb:0x2b3a8c, bus:'spi',
    pins:[['VCC', '電源 3.3 V'], ['GND', '接地'], ['CLK', 'SPI 時脈（接 MCU 的 SCK）'], ['DI', '資料輸入（接 MCU 的 MOSI）'], ['DO', '資料輸出（接 MCU 的 MISO）'], ['CS', '片選：低電位時被選中（接一支 GPIO）']],
    variants:[
      { id:'w25q32', name:'W25Q32JV 4 MB SPI Flash', part:'Winbond W25Q32JV', grade:1, dev:'w25q', cap:0x16, did:0x15, bytes:4 * 1024 * 1024, vmin:2.7, vmax:3.6, specs:[['容量', '32 Mbit（4 MB）'], ['JEDEC ID', 'EF 40 16'], ['頁大小', '256 位元組（一次最多寫一頁）'], ['抹除單位', '4 KB 磁區'], ['SPI 時脈', '最高 133 MHz'], ['工作電壓', '2.7–3.6 V']], links:[ds('搜尋 Datasheet', g('Winbond W25Q32JV'))] },
      { id:'w25q128', name:'W25Q128JV 16 MB SPI Flash', part:'Winbond W25Q128JV', grade:2, dev:'w25q', cap:0x18, did:0x17, bytes:16 * 1024 * 1024, vmin:2.7, vmax:3.6, better:'容量是 4 倍（16 MB），適合存放圖片或長時間的資料紀錄', specs:[['容量', '128 Mbit（16 MB）'], ['JEDEC ID', 'EF 40 18'], ['頁大小', '256 位元組'], ['抹除單位', '4 KB 磁區'], ['SPI 時脈', '最高 133 MHz'], ['工作電壓', '2.7–3.6 V']], links:[ds('搜尋 Datasheet', g('Winbond W25Q128JV'))] },
    ],
  },
  can: {
    name:'CAN 收發器模組', short:'CAN', w:24, d:28, pitch:4, pcb:0x1d4f91, bus:'can',
    pins:[['VCC', '電源（依型號）'], ['GND', '接地'], ['TXD', '接 MCU 的 CAN_TX'], ['RXD', '接 MCU 的 CAN_RX'], ['CANH', 'CAN 匯流排高端（接分析儀）'], ['CANL', 'CAN 匯流排低端（接分析儀）']],
    variants:[
      { id:'can-230', name:'SN65HVD230 CAN 收發器', part:'TI SN65HVD230', grade:1, vmin:3.0, vmax:3.6, specs:[['工作電壓', '3.3 V'], ['最高速率', '1 Mbps'], ['終端電阻', '板上 120 Ω'], ['測試節點', '模組內建，每 500 ms 送出 ID 0x200']], links:[ds('TI SN65HVD230 Datasheet（PDF）', 'https://www.ti.com/lit/ds/symlink/sn65hvd230.pdf')] },
      { id:'can-1050', name:'TJA1050 CAN 收發器', part:'NXP TJA1050', grade:1, vmin:4.75, vmax:5.25, specs:[['工作電壓', '5 V（接 3V3 不會動作）'], ['最高速率', '1 Mbps'], ['終端電阻', '板上 120 Ω'], ['測試節點', '模組內建，每 500 ms 送出 ID 0x200']], links:[ds('NXP TJA1050 Datasheet（PDF）', 'https://www.nxp.com/docs/en/data-sheet/TJA1050.pdf')] },
      { id:'can-332', name:'TCAN332 CAN FD 收發器', part:'TI TCAN332', grade:2, vmin:3.0, vmax:3.6, better:'3.3 V 供電、支援 CAN FD（最高 5 Mbps）', specs:[['工作電壓', '3.3 V'], ['最高速率', 'CAN FD 5 Mbps'], ['終端電阻', '板上 120 Ω'], ['測試節點', '模組內建，每 500 ms 送出 ID 0x200']], links:[ds('搜尋 Datasheet', g('TI TCAN332'))] },
    ],
  },
};

/* ---------- 步進馬達：TB67S128FTG 驅動模組＋雙極步進馬達 ---------- */
const TB67 = [ds('TB67S128FTG Datasheet（Toshiba，PDF）', 'https://toshiba.semicon-storage.com/info/docget.jsp?did=61073&prodName=TB67S128FTG'),
  ds('TB67S128FTG 產品頁（Toshiba）', 'https://toshiba.semicon-storage.com/us/semiconductor/product/motor-driver-ics/stepping-motor-driver-ics/detail.TB67S128FTG.html'),
  ds('Pololu TB67S128FTG 驅動板（腳位與設定說明）', 'https://www.pololu.com/product/2998')];
const DRV = [['驅動 IC', 'Toshiba TB67S128FTG（P-VQFN64，CLK-IN 模式）'], ['微步', '全步～1/128，模組上的 DMODE 指撥開關'], ['馬達電源', '24 V（模組上的端子，6.5–44 V）'], ['邏輯電位', 'IOREF 接 3V3（2–5.5 V）']];
MODULE_TYPES.stepper = {
  name:'步進馬達（TB67S128FTG）', short:'馬達', w:24, d:28, pcb:0x1d5c38, motor:true,
  pins:[['VCC', '邏輯電位 IOREF（接 3V3）'], ['GND', '接地'], ['CLK', 'STEP：每個上升緣前進一個微步（接計時器的 PWM 輸出）'], ['CW', 'CW/CCW：高電位順時針、低電位逆時針'], ['EN', 'ENABLE：高電位才會送電給馬達']],
  variants:[
    { id:'nema17', name:'NEMA 17 步進馬達 1.8°', part:'42 mm 雙極步進馬達（1.7 A）＋TB67S128FTG', grade:1, step:1.8, T:.40, J:5.4e-6, fc:250, rated:1.7, Iset:1.5, vmin:2, vmax:5.5,
      specs:[...DRV, ['步距角', '1.8°（一圈 200 個全步）'], ['保持轉矩', '0.40 N·m（額定 1.7 A）'], ['電流設定', '1.5 A（VREF ≈ 0.96 V）'], ['轉子慣量', '54 g·cm²']], links:TB67 },
    { id:'nema17-09', name:'NEMA 17 高解析 0.9°', part:'42 mm 0.9° 雙極步進馬達（1.7 A）＋TB67S128FTG', grade:2, step:.9, T:.44, J:6.8e-6, fc:180, rated:1.7, Iset:1.5, vmin:2, vmax:5.5, better:'一圈 400 個全步，定位更細；最高轉速比較低',
      specs:[...DRV, ['步距角', '0.9°（一圈 400 個全步）'], ['保持轉矩', '0.44 N·m'], ['電流設定', '1.5 A'], ['轉子慣量', '68 g·cm²']], links:TB67 },
    { id:'nema23', name:'NEMA 23 步進馬達 1.8°', part:'57 mm 雙極步進馬達（2.8 A）＋TB67S128FTG', grade:3, step:1.8, T:1.26, J:2.8e-5, fc:220, rated:2.8, Iset:2.0, vmin:2, vmax:5.5, better:'扭力約 3 倍，帶重負載也能加速（驅動 IC 要加散熱片）',
      specs:[...DRV, ['步距角', '1.8°（一圈 200 個全步）'], ['保持轉矩', '1.26 N·m（額定 2.8 A）'], ['電流設定', '2.0 A（驅動板不加散熱約可連續 2.1 A）'], ['轉子慣量', '280 g·cm²']], links:TB67 },
  ],
};

/* ---------- 量測儀器：邏輯分析儀（每一種都會顯示波形，可以點進去看解說與教學） ---------- */
const LA_VARIANTS = (pre, proto) => [
  { id:`${pre}-24m`, name:'USB 邏輯分析儀 24 MHz', part:'Cypress CY7C68013A（FX2LP）', grade:1, rate:24e6, specs:[['取樣率', '最高 24 MS/s'], ['通道', '8 通道'], ['輸入', '0–5 V 邏輯電位'], ['解碼', proto]], links:[ds('搜尋 CY7C68013A Datasheet', g('Cypress CY7C68013A FX2LP'))] },
  { id:`${pre}-100m`, name:'高速邏輯分析儀 100 MHz', part:'FPGA ＋ USB 2.0', grade:2, rate:100e6, better:'取樣率提高到 100 MS/s，訊號邊緣的位置更準確', specs:[['取樣率', '最高 100 MS/s'], ['通道', '16 通道'], ['輸入', '可調門檻 0.9–4 V'], ['解碼', proto]], links:[ds('搜尋 sigrok 支援的邏輯分析儀', 'https://sigrok.org/wiki/Supported_hardware')] },
];
const LA = (name, short, proto, pins, extra = {}) => ({ name, short, w:24, d: pins.length > 4 ? 28 : 24, pcb:0x1a1d22, analyzer:proto, pins, variants:LA_VARIANTS(short, proto.toUpperCase()), ...extra });
const GND_PROBE = ['GND', '接地：一定要和開發板共地，量到的電位才正確'];
Object.assign(MODULE_TYPES, {
  la_i2c: LA('I2C 分析儀', 'I2C 分析', 'i2c', [['SCL', '探棒：接 I2C 的 SCL 線'], ['SDA', '探棒：接 I2C 的 SDA 線'], GND_PROBE]),
  la_uart: LA('UART 分析儀', 'UART 分析', 'uart', [['TX', '探棒：接 MCU 的 TX（MCU 送出的資料）'], ['RX', '探棒：接 MCU 的 RX（MCU 收到的資料）'], GND_PROBE]),
  la_spi: LA('SPI 分析儀', 'SPI 分析', 'spi', [['SCK', '探棒：SPI 時脈'], ['MOSI', '探棒：主機送出的資料'], ['MISO', '探棒：從機回傳的資料'], ['CS', '探棒：片選'], GND_PROBE]),
  la_can: LA('CAN 分析儀', 'CAN 分析', 'can', [['CANH', '探棒：CAN 匯流排高端'], ['CANL', '探棒：CAN 匯流排低端'], GND_PROBE], {
    variants:[
      { id:'can-24m', name:'邏輯分析儀＋CAN 差動探棒', part:'CY7C68013A ＋ SN65HVD230', grade:1, rate:24e6, specs:[['取樣率', '最高 24 MS/s'], ['輸入', 'CANH／CANL 差動'], ['模式', '只聽不回（不送 ACK）'], ['解碼', 'CAN 2.0A／B']], links:[ds('TI SN65HVD230 Datasheet（PDF）', 'https://www.ti.com/lit/ds/symlink/sn65hvd230.pdf')] },
      { id:'can-scope', name:'數位示波器（CAN 解碼）', part:'100 MHz 4 通道示波器', grade:2, rate:100e6, better:'取樣率更高，可以看清楚 CANH／CANL 的電壓變化', specs:[['取樣率', '最高 100 MS/s（顯示）'], ['輸入', '2 通道電壓'], ['模式', '只聽不回（不送 ACK）'], ['解碼', 'CAN 2.0A／B']], links:[ds('搜尋 CAN 匯流排量測教學', g('CAN bus oscilloscope decode'))] },
    ] }),
});

export const TYPE_ORDER = ['led', 'rgb', 'button', 'pir', 'pot', 'temp', 'buzzer', 'relay', 'tc', 'flash', 'can', 'stepper', 'la_i2c', 'la_uart', 'la_spi', 'la_can'];
export const MODULE_GROUPS = [['輸出', ['led', 'rgb', 'buzzer', 'relay']], ['輸入與感測', ['button', 'pir', 'pot', 'temp']], ['SPI／CAN 元件', ['tc', 'flash', 'can']], ['馬達', ['stepper']], ['量測儀器（邏輯分析儀）', ['la_i2c', 'la_uart', 'la_spi', 'la_can']]];
export const variantOf = (type, vid) => MODULE_TYPES[type].variants.find(v => v.id === vid) || MODULE_TYPES[type].variants[0];
export const MAX_MODULES = 12;
export const DEFAULT_MODULES = [
  { type:'led', variant:'led-red' },
  { type:'button', variant:'btn-tact' },
  { type:'temp', variant:'bme280' },
  { type:'pot', variant:'pot-rotary' },
  { type:'buzzer', variant:'buz-3v' },
];

/* ---------- 麵包板電源軌 ---------- */
export const RAIL_HOLES = 14;
