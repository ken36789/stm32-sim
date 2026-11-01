// 開發板資料庫：ST（STM32，37 塊）＋ TI（boards-ti.js）＋ NXP（boards-nxp.js）。
// ST 排針採各板的 Arduino 相容腳位（Nucleo）或晶片腳位名稱（Pill、Discovery），每塊 30–40 腳。
import { TI_BOARDS } from './boards-ti.js';
import { NXP_BOARDS } from './boards-nxp.js';
import { extendHeader, pinTags } from './board-kit.js';

/* ---------- 板型（外形與排針配置） ---------- */
export const FORMS = {
  n144:  { name:'Nucleo-144', w:92, d:124, pcb:0x15191d, dbg:true },
  n64:   { name:'Nucleo-64',  w:82, d:112, pcb:0x15191d, dbg:true },
  n32:   { name:'Nucleo-32',  w:44, d:84,  pcb:0x15191d, dbg:true },
  pill:  { name:'Pill 小板',  w:40, d:108, pcb:0x1f4fa8, dbg:false },
  disco: { name:'Discovery',  w:84, d:112, pcb:0x14281e, dbg:true },
  lp:    { name:'LaunchPad',  w:84, d:112, pcb:0x9b1c1f, dbg:true },
  frdm:  { name:'FRDM／LPCXpresso', w:84, d:112, pcb:0x1e2a3a, dbg:true },
  evk:   { name:'EVK 評估套件', w:92, d:124, pcb:0x1c3324, dbg:true },
  eval:  { name:'模擬器通用評估板', w:80, d:108, pcb:0x22303c, dbg:true },
};

const ARD64  = { A0:'PA0', A1:'PA1', A2:'PA4', A3:'PB0', A4:'PC1', A5:'PC0', D0:'PA3', D1:'PA2', D2:'PA10', D3:'PB3', D4:'PB5', D5:'PB4', D6:'PB10', D7:'PA8', D8:'PA9', D9:'PC7', D10:'PB6', D11:'PA7', D12:'PA6', D13:'PA5', D14:'PB9', D15:'PB8' };
const ARD144 = { A0:'PA3', A1:'PC0', A2:'PC3', A3:'PF3', A4:'PF5', A5:'PF10', D0:'PG9', D1:'PG14', D2:'PF15', D3:'PE13', D4:'PF14', D5:'PE11', D6:'PE9', D7:'PF13', D8:'PF12', D9:'PD15', D10:'PD14', D11:'PA7', D12:'PA6', D13:'PA5', D14:'PB9', D15:'PB8' };
const ARD32  = { D0:'PA10', D1:'PA9', D2:'PA12', D3:'PB0', D4:'PB7', D5:'PB6', D6:'PB1', D7:'PF0', D8:'PF1', D9:'PA8', D10:'PA11', D11:'PB5', D12:'PB4', D13:'PB3', A0:'PA0', A1:'PA1', A2:'PA3', A3:'PA4', A4:'PA5', A5:'PA6', A6:'PA7', A7:'PA2' };
const ARD = ['A0','A1','A2','A3','A4','A5','D0','D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13','D14','D15'];
const PWR4 = ['3V3', '5V', 'GND', 'GND'];

// 每個項目是排針上的一支腳；依序兩兩一排（第 1 腳在左上）
const HEADERS = {
  n144: [...PWR4, ...ARD, 'PC6', 'PC8', 'PC9', 'PC10', 'PC11', 'PC12', 'PD2', 'PE2', 'PE3', 'PE4', ...PWR4],
  n64:  [...PWR4, ...ARD, 'PC2', 'PC3', 'PC8', 'PC9', 'PC10', 'PC11', 'PB12', 'PB13', 'PB14', 'PB15', ...PWR4],
  n32:  [...PWR4, 'D0','D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13','A0','A1','A2','A3','A4','A5','A6','A7', '3V3', 'GND', '5V', 'GND'],
  pill: [...PWR4, 'PA0','PA1','PA2','PA3','PA4','PA5','PA6','PA7','PB0','PB1','PB10','PB12','PB13','PB14','PB15','PA8','PA9','PA10','PA11','PA12','PA15','PB3','PB4','PB5','PB6','PB7','PB8','PB9','PC13','PC14','PC15', 'GND', ...PWR4],
  disco:[...PWR4, 'PA1','PA2','PA3','PA8','PB0','PB1','PB6','PB9','PB10','PB11','PB12','PB13','PB14','PB15','PC1','PC2','PC4','PC5','PC6','PD8','PD9','PD10','PD11','PE7','PE8','PE9','PE10','PE11','PE12','PE13','PE14','PE15', ...PWR4],
};
const PWM_D = ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'];

/* ---------- 開發板清單 ---------- */
const H7_LEDS = [['LD1','PB0','green'], ['LD2','PE1','yellow'], ['LD3','PB14','red']];
const F7_LEDS = [['LD1','PB0','green'], ['LD2','PB7','blue'], ['LD3','PB14','red']];
const B1 = ['B1', 'PC13', false];
const V144 = ['USART3', 'PD8', 'PD9', 'huart3'], V64 = ['USART2', 'PA2', 'PA3', 'huart2'], V32 = ['USART2', 'PA2', 'PA15', 'huart2'], VP = ['USART1', 'PA9', 'PA10', 'huart1'];
const N64_LED = [['LD2','PA5','green']], N32_LED = [['LD3','PB3','green']];

// [id, 名稱, 系列, MCU, 核心, MHz, Flash KB, RAM KB, 板型, 燒錄器, Device ID, 封裝, LED, 按鈕, VCP, 其他]
const RAW = [
  ['nucleo-h743zi2', 'NUCLEO-H743ZI2', 'H7', 'STM32H743ZIT6', 'Cortex-M7', 480, 2048, 1024, 'n144', 'ST-LINK V3E', '0x450', 'LQFP144', H7_LEDS, B1, V144, { page:'nucleo-h743zi' }],
  ['nucleo-h723zg', 'NUCLEO-H723ZG', 'H7', 'STM32H723ZGT6', 'Cortex-M7', 550, 1024, 564, 'n144', 'ST-LINK V3E', '0x483', 'LQFP144', H7_LEDS, B1, V144],
  ['nucleo-h753zi', 'NUCLEO-H753ZI', 'H7', 'STM32H753ZIT6', 'Cortex-M7', 480, 2048, 1024, 'n144', 'ST-LINK V3E', '0x450', 'LQFP144', H7_LEDS, B1, V144],
  ['nucleo-h7a3zi-q', 'NUCLEO-H7A3ZI-Q', 'H7', 'STM32H7A3ZIT6Q', 'Cortex-M7', 280, 2048, 1376, 'n144', 'ST-LINK V3E', '0x480', 'LQFP144', H7_LEDS, B1, V144],
  ['nucleo-h563zi', 'NUCLEO-H563ZI', 'H5', 'STM32H563ZIT6', 'Cortex-M33', 250, 2048, 640, 'n144', 'ST-LINK V3EC', '0x484', 'LQFP144', [['LD1','PB0','green'], ['LD2','PF4','yellow'], ['LD3','PG4','red']], B1, V144],
  ['nucleo-f767zi', 'NUCLEO-F767ZI', 'F7', 'STM32F767ZIT6', 'Cortex-M7', 216, 2048, 512, 'n144', 'ST-LINK V2-1', '0x451', 'LQFP144', F7_LEDS, B1, V144],
  ['nucleo-f746zg', 'NUCLEO-F746ZG', 'F7', 'STM32F746ZGT6', 'Cortex-M7', 216, 1024, 320, 'n144', 'ST-LINK V2-1', '0x449', 'LQFP144', F7_LEDS, B1, V144],
  ['nucleo-f429zi', 'NUCLEO-F429ZI', 'F4', 'STM32F429ZIT6', 'Cortex-M4', 180, 2048, 256, 'n144', 'ST-LINK V2-1', '0x419', 'LQFP144', F7_LEDS, B1, V144],
  ['nucleo-f439zi', 'NUCLEO-F439ZI', 'F4', 'STM32F439ZIT6', 'Cortex-M4', 180, 2048, 256, 'n144', 'ST-LINK V2-1', '0x419', 'LQFP144', F7_LEDS, B1, V144],
  ['nucleo-f413zh', 'NUCLEO-F413ZH', 'F4', 'STM32F413ZHT6', 'Cortex-M4', 100, 1536, 320, 'n144', 'ST-LINK V2-1', '0x463', 'LQFP144', F7_LEDS, B1, V144],
  ['nucleo-f207zg', 'NUCLEO-F207ZG', 'F2', 'STM32F207ZGT6', 'Cortex-M3', 120, 1024, 128, 'n144', 'ST-LINK V2-1', '0x411', 'LQFP144', F7_LEDS, B1, V144],
  ['nucleo-l4r5zi', 'NUCLEO-L4R5ZI', 'L4', 'STM32L4R5ZIT6', 'Cortex-M4', 120, 2048, 640, 'n144', 'ST-LINK V2-1', '0x470', 'LQFP144', [['LD1','PC7','green'], ['LD2','PB7','blue'], ['LD3','PB14','red']], B1, ['LPUART1', 'PG7', 'PG8', 'hlpuart1']],
  ['nucleo-u575zi-q', 'NUCLEO-U575ZI-Q', 'U5', 'STM32U575ZIT6Q', 'Cortex-M33', 160, 2048, 786, 'n144', 'ST-LINK V2-1', '0x482', 'LQFP144', [['LD1','PC7','green'], ['LD2','PB7','blue'], ['LD3','PG2','red']], B1, VP],
  ['nucleo-f401re', 'NUCLEO-F401RE', 'F4', 'STM32F401RET6', 'Cortex-M4', 84, 512, 96, 'n64', 'ST-LINK V2-1', '0x433', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f411re', 'NUCLEO-F411RE', 'F4', 'STM32F411RET6', 'Cortex-M4', 100, 512, 128, 'n64', 'ST-LINK V2-1', '0x431', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f446re', 'NUCLEO-F446RE', 'F4', 'STM32F446RET6', 'Cortex-M4', 180, 512, 128, 'n64', 'ST-LINK V2-1', '0x421', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f410rb', 'NUCLEO-F410RB', 'F4', 'STM32F410RBT6', 'Cortex-M4', 100, 128, 32, 'n64', 'ST-LINK V2-1', '0x458', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f303re', 'NUCLEO-F303RE', 'F3', 'STM32F303RET6', 'Cortex-M4', 72, 512, 80, 'n64', 'ST-LINK V2-1', '0x446', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f103rb', 'NUCLEO-F103RB', 'F1', 'STM32F103RBT6', 'Cortex-M3', 72, 128, 20, 'n64', 'ST-LINK V2-1', '0x410', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f072rb', 'NUCLEO-F072RB', 'F0', 'STM32F072RBT6', 'Cortex-M0', 48, 128, 16, 'n64', 'ST-LINK V2-1', '0x448', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-f030r8', 'NUCLEO-F030R8', 'F0', 'STM32F030R8T6', 'Cortex-M0', 48, 64, 8, 'n64', 'ST-LINK V2-1', '0x440', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-g474re', 'NUCLEO-G474RE', 'G4', 'STM32G474RET6', 'Cortex-M4', 170, 512, 128, 'n64', 'ST-LINK V3E', '0x469', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-g431rb', 'NUCLEO-G431RB', 'G4', 'STM32G431RBT6', 'Cortex-M4', 170, 128, 32, 'n64', 'ST-LINK V3E', '0x468', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-g071rb', 'NUCLEO-G071RB', 'G0', 'STM32G071RBT6', 'Cortex-M0+', 64, 128, 36, 'n64', 'ST-LINK V2-1', '0x460', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-l476rg', 'NUCLEO-L476RG', 'L4', 'STM32L476RGT6', 'Cortex-M4', 80, 1024, 128, 'n64', 'ST-LINK V2-1', '0x415', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-l452re', 'NUCLEO-L452RE', 'L4', 'STM32L452RET6', 'Cortex-M4', 80, 512, 160, 'n64', 'ST-LINK V2-1', '0x462', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-l152re', 'NUCLEO-L152RE', 'L1', 'STM32L152RET6', 'Cortex-M3', 32, 512, 80, 'n64', 'ST-LINK V2-1', '0x437', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-l073rz', 'NUCLEO-L073RZ', 'L0', 'STM32L073RZT6', 'Cortex-M0+', 32, 192, 20, 'n64', 'ST-LINK V2-1', '0x447', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-l053r8', 'NUCLEO-L053R8', 'L0', 'STM32L053R8T6', 'Cortex-M0+', 32, 64, 8, 'n64', 'ST-LINK V2-1', '0x417', 'LQFP64', N64_LED, B1, V64],
  ['nucleo-l432kc', 'NUCLEO-L432KC', 'L4', 'STM32L432KCU6', 'Cortex-M4', 80, 256, 64, 'n32', 'ST-LINK V2-1', '0x435', 'UFQFPN32', N32_LED, null, V32, { pins:{ D7:'PC14', D8:'PC15' } }],
  ['nucleo-g431kb', 'NUCLEO-G431KB', 'G4', 'STM32G431KBT6', 'Cortex-M4', 170, 128, 32, 'n32', 'ST-LINK V3E', '0x468', 'LQFP32', N32_LED, null, V32],
  ['nucleo-f303k8', 'NUCLEO-F303K8', 'F3', 'STM32F303K8T6', 'Cortex-M4', 72, 64, 16, 'n32', 'ST-LINK V2-1', '0x439', 'LQFP32', N32_LED, null, V32],
  ['nucleo-f042k6', 'NUCLEO-F042K6', 'F0', 'STM32F042K6T6', 'Cortex-M0', 48, 32, 6, 'n32', 'ST-LINK V2-1', '0x445', 'LQFP32', N32_LED, null, V32],
  ['bluepill-f103c8', 'Blue Pill（F103C8）', 'F1', 'STM32F103C8T6', 'Cortex-M3', 72, 64, 20, 'pill', 'ST-LINK V2（外接）', '0x410', 'LQFP48', [['LED','PC13','green', true]], null, VP, { board:'https://stm32-base.org/boards/STM32F103C8T6-Blue-Pill.html', xtal:'8 MHz' }],
  ['blackpill-f411ce', 'Black Pill（F411CE）', 'F4', 'STM32F411CEU6', 'Cortex-M4', 100, 512, 128, 'pill', 'ST-LINK V2（外接）', '0x431', 'UFQFPN48', [['LED','PC13','blue', true]], ['KEY', 'PA0', true], VP, { pcb:0x16181b, board:'https://github.com/WeActStudio/WeActStudio.MiniSTM32F4x1', xtal:'25 MHz' }],
  ['blackpill-f401cc', 'Black Pill（F401CC）', 'F4', 'STM32F401CCU6', 'Cortex-M4', 84, 256, 64, 'pill', 'ST-LINK V2（外接）', '0x423', 'UFQFPN48', [['LED','PC13','blue', true]], ['KEY', 'PA0', true], VP, { pcb:0x16181b, board:'https://github.com/WeActStudio/WeActStudio.MiniSTM32F4x1', xtal:'25 MHz' }],
  ['stm32f407g-disc1', 'STM32F407G-DISC1', 'F4', 'STM32F407VGT6', 'Cortex-M4', 168, 1024, 192, 'disco', 'ST-LINK V2-A', '0x413', 'LQFP100', [['LD4','PD12','green'], ['LD3','PD13','orange'], ['LD5','PD14','red'], ['LD6','PD15','blue']], ['B1', 'PA0', false], V64, { page:'stm32f4discovery' }],
];

const LED_HEX = { green:0x2fe36b, yellow:0xffc21a, red:0xff3b30, blue:0x3d7bff, orange:0xff8a1f };

function buildBoard(r){
  const [id, name, series, mcu, core, mhz, flash, ram, form, prog, devId, pkg, leds, btn, vcp, extra = {}] = r;
  const base = mcu.match(/^STM32[A-Z0-9]{4}[A-Z0-9]{2}/)[0].toLowerCase();
  const ard = { ...(form === 'n144' ? ARD144 : form === 'n32' ? ARD32 : ARD64), ...(extra.pins || {}) };
  const i2c = form === 'n32' ? { bus:'I2C1', scl:'D5', sda:'D4' } : form === 'pill' ? { bus:'I2C1', scl:'PB6', sda:'PB7' } : form === 'disco' ? { bus:'I2C1', scl:'PB6', sda:'PB9' } : { bus:'I2C1', scl:'D15', sda:'D14' };
  // SPI：Nucleo-64 與 Discovery 用 SPI2（避開 D13＝PA5 的板載 LED）；Nucleo-32 用 PA5–PA7（避開 D13＝PB3 的 LD3）
  const spi = { n144:{ bus:'SPI1', inst:'SPI1', sck:'D13', miso:'D12', mosi:'D11', cs:'D10' }, n64:{ bus:'SPI2', inst:'SPI2', sck:'PB13', miso:'PB14', mosi:'PB15', cs:'PB12' },
    n32:{ bus:'SPI1', inst:'SPI1', sck:'A4', miso:'A5', mosi:'A6', cs:'D3' }, pill:{ bus:'SPI1', inst:'SPI1', sck:'PA5', miso:'PA6', mosi:'PA7', cs:'PA4' }, disco:{ bus:'SPI2', inst:'SPI2', sck:'PB13', miso:'PB14', mosi:'PB15', cs:'PB12' } }[form];
  // CAN：G4、H5、H7、U5 是 FDCAN；F0／F1／F3 是單一 bxCAN（hcan）；F2／F4／F7／L4 是 CAN1（hcan1）
  const NOCAN = ['STM32F401', 'STM32F411', 'STM32F410', 'STM32F030', 'STM32G071', 'STM32L152', 'STM32L073', 'STM32L053'];
  const fd = ['H7', 'H5', 'G4', 'U5'].includes(series), single = ['F0', 'F1', 'F3'].includes(series);
  const canPins = form === 'n64' ? { rx:'PA11', tx:'PA12' } : form === 'n32' ? { rx:'D10', tx:'D2' } : form === 'pill' ? { rx:'PB8', tx:'PB9' } : { rx:'PD0', tx:'PD1' };
  const noCan = NOCAN.some(x => mcu.startsWith(x)) ? `${mcu.slice(0, 9)} 沒有 CAN 控制器。要做 CAN 實驗，請換成 F446、F103、G474、H743 等有 CAN 的晶片。` : null;
  const can = noCan ? null : { bus: fd ? 'FDCAN1' : single ? 'CAN' : 'CAN1', inst: fd ? 'FDCAN1' : 'CAN1', handle: fd ? 'hfdcan1' : single ? 'hcan' : 'hcan1', drv: fd ? 'fdcan' : 'bxcan', ...canPins };
  const o = { spi, can };
  const labels = extendHeader(HEADERS[form], ard, [vcp[1], vcp[2], spi.sck, spi.miso, spi.mosi, spi.cs, can?.tx, can?.rx]);
  const counts = {};
  const header = labels.map(label => {
    const n = counts[label] = (counts[label] || 0) + 1;
    const total = labels.filter(x => x === label).length;
    const pid = 'J.' + (total > 1 ? `${label}~${n}` : label);
    const kind = label === 'GND' ? 'gnd' : (label === '3V3' || label === '5V') ? 'pwr' : 'gpio';
    const mcuPin = kind !== 'gpio' ? null : (ard[label] || label);
    const tags = [];
    if (kind === 'gpio'){
      if (/^A\d$/.test(label) || (form === 'pill' && /^P(A[0-7]|B[01])$/.test(label)) || (form === 'disco' && /^P(A[123]|B[01]|C[1245])$/.test(label))) tags.push('adc');
      if (label === i2c.scl) tags.push('scl');
      if (label === i2c.sda) tags.push('sda');
      if (mcuPin === vcp[1] || mcuPin === vcp[2]) tags.push('vcp');
      if ((form === 'n64' || form === 'n144' || form === 'n32') && PWM_D.includes(label)) tags.push('pwm');
      if (leds.some(l => l[1] === mcuPin)) tags.push('led');
      tags.push(...pinTags(label, mcuPin, o));
    }
    return { id:pid, label, kind, mcu:mcuPin, tags };
  });
  const v3 = /V3/.test(prog), pill = form === 'pill';
  return {
    vendor:'ST', sdk:'stm32hal', pinStyle:'st', kind:'official', adcBits:12, adcDrv:'hal', adcInst:'ADC1', note:null,
    dbg: pill ? null : { name:prog, part: v3 ? 'STM32F723IEK6' : 'STM32F103CBT6', desc:'板上的 ST-LINK，負責 SWD 燒錄、除錯與虛擬序列埠（VCP）。', url: v3 ? 'https://www.st.com/en/development-tools/stlink-v3set.html' : 'https://www.st.com/en/development-tools/st-link-v2.html' },
    ldo: pill ? { part:'XC6206P332MR（662K）', desc:'小型 LDO，最大輸出約 200 mA，外接模組不宜過多。', url:'https://www.google.com/search?q=XC6206P332MR+datasheet+pdf' }
      : { part:'LD39050PU33R', desc:'低壓降穩壓器，最大輸出 500 mA。外接模組的 3V3 都從這裡供電。', url:'https://www.st.com/resource/en/datasheet/ld39050.pdf' },
    id, name, series, mcu, core, mhz, flash, ram, form, prog, devId, pkg, base,
    leds: leds.map(([n, pin, color, activeLow]) => ({ name:n, pin, color, hex:LED_HEX[color], activeLow:!!activeLow })),
    btn: btn ? { name:btn[0], pin:btn[1], activeLow:btn[2] } : null,
    vcp: { periph:vcp[0], tx:vcp[1], rx:vcp[2], handle:vcp[3] },
    i2c:{ ...i2c, inst:'I2C1' }, spi, noSpi:null, can, noCan, header, pcb: extra.pcb ?? FORMS[form].pcb, xtal: extra.xtal || null,
    links: [
      { label:`${mcu} Datasheet（PDF）`, url:`https://www.st.com/resource/en/datasheet/${base}.pdf` },
      { label:'MCU 產品頁（參考手冊、勘誤表）', url:`https://www.st.com/en/microcontrollers-microprocessors/${base}.html` },
      extra.board ? { label:'開發板資料', url:extra.board } : { label:'開發板產品頁（使用手冊、電路圖）', url:`https://www.st.com/en/evaluation-tools/${extra.page || id}.html` },
    ],
  };
}

export const BOARDS = [...RAW.map(buildBoard), ...TI_BOARDS, ...NXP_BOARDS];
export const BOARD_BY_ID = Object.fromEntries(BOARDS.map(b => [b.id, b]));
export const DEFAULT_BOARD = 'nucleo-h743zi2';
export const VENDORS = [
  { id:'ST', name:'STMicroelectronics', series:['H7', 'H5', 'F7', 'F4', 'F3', 'F2', 'F1', 'F0', 'G4', 'G0', 'U5', 'L4', 'L1', 'L0'] },
  { id:'TI', name:'Texas Instruments', series:['MSPM0', 'MSP430', 'TM4C', 'C2000'] },
  { id:'NXP', name:'NXP', series:['Kinetis', 'MCX', 'LPC', 'LPC800', 'i.MX RT'] },
];
export const seriesLabel = (vendor, s) => vendor === 'ST' ? 'STM32' + s : s;

/** 開發板上的其他元件（顯示在「元件」分頁，附 datasheet） */
export function boardParts(b){
  const parts = [{ key:'mcu', name:'主控 MCU', part:b.mcu, desc:`${b.core} · ${b.mhz} MHz · Flash ${fmtKB(b.flash)} · RAM ${fmtKB(b.ram)} · ${b.pkg}`, links:b.links.slice(0, 2) }];
  if (b.dbg) parts.push({ key:'stlink', name:`燒錄器 ${b.dbg.name}`, part:b.dbg.part, desc:b.dbg.desc, links:[{ label:`${b.dbg.name} 產品資訊`, url:b.dbg.url }] });
  if (b.ldo) parts.push({ key:'ldo', name:'3.3 V 穩壓器', part:b.ldo.part, desc:b.ldo.desc, links:[{ label:`${b.ldo.part.split('（')[0]} Datasheet`, url:b.ldo.url }] });
  if (b.xtal) parts.push({ key:'xtal', name:'外部晶振', part:b.xtal, desc:'HSE 時脈來源，經 PLL 倍頻成系統時脈。', links:[] });
  return parts;
}
/** 程式在 Flash（或外部 Flash）的起始位址 */
export function flashBase(b){
  if (b.vendor === 'ST') return 0x08000000;
  if (b.series === 'MSP430') return /FR2|FR4/.test(b.mcu) ? 0x8000 : /FR5|FR6/.test(b.mcu) ? 0x4400 : 0x4400;
  if (b.series === 'C2000') return 0x80000;
  if (b.series === 'i.MX RT') return 0x60000000;
  return 0x00000000;
}
export const hexAddr = n => '0x' + n.toString(16).toUpperCase().padStart(8, '0').replace(/(.{4})(.{4})/, '$1 $2');
export const fmtKB = kb => !kb ? '外部 Flash' : kb >= 1024 ? `${+(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
export const pinTitle = p => p.kind === 'gpio' && p.mcu && p.mcu !== p.label ? `${p.label}（${p.mcu}）` : p.label;
