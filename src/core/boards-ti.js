// TI 晶片：MSPM0（DriverLib）、MSP430（DriverLib）、TM4C（TivaWare）、C2000（C2000Ware driverlib）
// kind 'official'：依官方 LaunchPad 使用手冊的腳位；'eval'：模擬器通用評估板（腳位功能依 datasheet 的腳位多工設定）
import { makeBoard, PWR } from './board-kit.js';

const hdr = gpio => { const h = [...PWR, ...gpio, ...PWR]; if (h.length % 2) h.push('GND'); return h; };
const LP_RED = 0x9b1c1f, EVAL = 0x22303c;
const SDK = { mspm0:['MSPM0 SDK（DriverLib）', 'MSPM0-SDK'], msp430:['MSP430Ware（DriverLib）', 'MSPWARE'], tivaware:['TivaWare（SW-TM4C）', 'SW-TM4C'], c2000:['C2000Ware（driverlib）', 'C2000WARE'] };
const links = (gpn, tool, sdk) => [
  { label:`${gpn} Datasheet（PDF）`, url:`https://www.ti.com/lit/ds/symlink/${gpn.toLowerCase()}.pdf` },
  { label:'TI 產品頁（技術參考手冊、勘誤表）', url:`https://www.ti.com/product/${gpn}` },
  ...(tool ? [{ label:`${tool} 使用手冊與電路圖`, url:`https://www.ti.com/tool/${tool}` }] : []),
  { label:SDK[sdk][0], url:`https://www.ti.com/tool/${SDK[sdk][1]}` },
];
const XDS110 = { name:'XDS110', part:'TM4C1294NCPDT', desc:'板上的 XDS110 除錯器，負責 JTAG/SWD 燒錄與 UART 虛擬序列埠。', url:'https://www.ti.com/tool/TMDSEMU110-U' };
const ICDI = { name:'Stellaris ICDI', part:'TM4C123GH6PMI', desc:'板上的 ICDI 除錯器，負責燒錄與虛擬序列埠。', url:'https://www.ti.com/tool/EK-TM4C123GXL' };
const XDS100 = { name:'XDS100v2', part:'FT2232H', desc:'板上的 XDS100v2（FTDI FT2232H），負責 JTAG 燒錄與 SCI 虛擬序列埠。', url:'https://www.ti.com/tool/TMDSEMU100V2U-14T' };
const LDO = { part:'TPS73533', desc:'3.3 V 低壓降穩壓器，最大 500 mA。', url:'https://www.ti.com/lit/ds/symlink/tps735.pdf' };
const EVAL_NOTE = '模擬器通用評估板：晶片腳位名稱與周邊功能依 datasheet，LED、按鈕與 I2C／UART 的接法是本模擬器的 SysConfig 設定，不是官方開發板。';
const base = (o, sdk, tool) => makeBoard({ vendor:'TI', sdk, kind: tool ? 'official' : 'eval', pcb: tool ? LP_RED : EVAL, note: tool ? null : EVAL_NOTE, ldo:LDO,
  links:links(o.gpn || o.mcu, tool, sdk), ...o, id:o.id || o.mcu.toLowerCase(), name: tool || `${o.mcu} 評估板`, form: tool ? 'lp' : 'eval' });

/* ---------- MSPM0（Arm Cortex-M0+） ---------- */
const M0G = ['PA8','PA9','PA12','PA13','PA14','PA15','PA16','PA17','PA21','PA22','PA23','PA24','PA25','PA26','PA27','PA28','PA29','PA30','PA31','PB0','PB1','PB2','PB3','PB4','PB6','PB7','PB8','PB9','PB12','PB13','PB15','PB16','PB17','PB18','PB19','PB20'];
const m0g = (mcu, flash, ram, opts = {}) => base({ mcu, series:'MSPM0', core:'Cortex-M0+', mhz:80, flash, ram, pkg:'LQFP-64', prog:'XDS110', dbg:XDS110, pinStyle:'st',
  header:hdr(M0G), adc:['PA27','PA26','PA25','PA24','PA15','PA16','PA17'], i2c:{ bus:'I2C1', inst:'I2C1', scl:'PB2', sda:'PB3' },
  leds:[['LED1','PA0','red',true], ['LED2R','PB26','red'], ['LED2G','PB27','green'], ['LED2B','PB22','blue']], btn:['S2','PB21',true], vcp:['UART0','PA10','PA11'],
  adcDrv:'dl', adcInst:'ADC0', ...opts }, 'mspm0', opts.tool);
const M0L = ['PA1','PA2','PA3','PA4','PA5','PA6','PA7','PA8','PA9','PA10','PA11','PA12','PA15','PA16','PA17','PA18','PA21','PA24','PA25','PA26','PA27'];
const m0l = (mcu, mhz, flash, ram, pkg, opts = {}) => base({ mcu, series:'MSPM0', core:'Cortex-M0+', mhz, flash, ram, pkg, prog:'XDS110', dbg:XDS110, pinStyle:'st',
  header:hdr(M0L), adc:['PA27','PA26','PA25','PA24'], i2c:{ bus:'I2C0', inst:'I2C0', scl:'PA11', sda:'PA10' },
  leds:[['LED1','PA0','red',true], ['LED2','PA13','green']], btn:['S2','PA14',true], vcp:['UART0','PA23','PA22'], adcDrv:'dl', adcInst:'ADC0', ...opts }, 'mspm0');

/* ---------- MSP430（FRAM／Flash，16 位元） ---------- */
const FR2355 = ['P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7','P2.0','P2.1','P2.2','P2.4','P2.5','P2.6','P2.7','P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P4.4','P4.5','P4.6','P4.7','P5.0','P5.1','P5.2','P5.3','P5.4','P6.0','P6.1','P6.2','P6.3','P6.4','P6.5'];
const fr2355 = (mcu, mhz, flash, ram, tool) => base({ mcu, series:'MSP430', core:'MSP430 16 位元', mhz, flash, ram, pkg:'LQFP-48', prog:'eZ-FET', dbg:{ ...XDS110, name:'eZ-FET', part:'MSP430F5528', desc:'板上的 eZ-FET 除錯器，負責 Spy-Bi-Wire 燒錄與 UART 虛擬序列埠。' }, pinStyle:'msp430',
  header:hdr(FR2355), adc:['P1.1','P1.4','P1.5','P1.6','P1.7','P5.0','P5.1','P5.2','P5.3'], i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P1.3', sda:'P1.2' },
  leds:[['LED1','P1.0','red'], ['LED2','P6.6','green']], btn:['S1','P4.1',true], vcp:['eUSCI_A1','P4.3','P4.2'], adcDrv:'ADC', adcBits:12 }, 'msp430', tool);
const msp = o => base({ series:'MSP430', core:'MSP430 16 位元', prog:'eZ-FET', dbg:{ ...XDS110, name:'eZ-FET', part:'MSP430F5528', desc:'板上的 eZ-FET 除錯器，負責 Spy-Bi-Wire 燒錄與 UART 虛擬序列埠。' }, pinStyle:'msp430', ...o, header:hdr(o.gpio) }, 'msp430', o.tool);

/* ---------- TM4C（Tiva C，Cortex-M4F） ---------- */
const TM123 = ['PA2','PA3','PA4','PA5','PA6','PA7','PB0','PB1','PB2','PB3','PB4','PB5','PB6','PB7','PC4','PC5','PC6','PC7','PD0','PD1','PD2','PD3','PD6','PE0','PE1','PE2','PE3','PE4','PE5'];
const TM129 = ['PB2','PB3','PB4','PB5','PC4','PC5','PC6','PC7','PD0','PD1','PD2','PD3','PD4','PD5','PE0','PE1','PE2','PE3','PE4','PE5','PH0','PH1','PH2','PH3','PK0','PK1','PK2','PK3','PK4','PK5','PK6','PK7','PL0','PL1','PL2','PL3'];
const tm123 = (mcu, pkg, tool) => base({ mcu, series:'TM4C', core:'Cortex-M4F', mhz:80, flash:256, ram:32, pkg, prog:'Stellaris ICDI', dbg:ICDI, pinStyle:'st',
  header:hdr(TM123), adc:['PE3','PE2','PE1','PE0','PD3','PD2','PD1','PD0','PE5','PE4','PB4','PB5'], i2c:{ bus:'I2C0', inst:'I2C0', scl:'PB2', sda:'PB3' },
  leds:[['LEDR','PF1','red'], ['LEDB','PF2','blue'], ['LEDG','PF3','green']], btn:['SW1','PF4',true], vcp:['UART0','PA1','PA0'], adcDrv:'tiva', adcInst:'ADC0' }, 'tivaware', tool);
const tm129 = (mcu, flash, pkg, tool) => base({ mcu, series:'TM4C', core:'Cortex-M4F', mhz:120, flash, ram:256, pkg, prog:'Stellaris ICDI', dbg:ICDI, pinStyle:'st',
  header:hdr(TM129), adc:['PE3','PE2','PE1','PE0','PD3','PD2','PD1','PD0','PE5','PE4','PB4','PB5','PK0','PK1','PK2','PK3'], i2c:{ bus:'I2C0', inst:'I2C0', scl:'PB2', sda:'PB3' },
  leds:[['D1','PN1','green'], ['D2','PN0','green'], ['D3','PF4','green'], ['D4','PF0','green']], btn:['SW1','PJ0',true], vcp:['UART0','PA1','PA0'], adcDrv:'tiva', adcInst:'ADC0' }, 'tivaware', tool);

/* ---------- C2000（C28x DSP） ---------- */
const C79 = ['GPIO0','GPIO1','GPIO2','GPIO3','GPIO4','GPIO5','GPIO6','GPIO7','GPIO8','GPIO9','GPIO10','GPIO11','GPIO14','GPIO15','GPIO16','GPIO17','GPIO18','GPIO19','GPIO22','GPIO24','GPIO25','GPIO26','GPIO27','GPIO32','GPIO40','GPIO41','GPIO52','GPIO104','GPIO105','ADCINA0','ADCINA1','ADCINA2','ADCINA3','ADCINB2','ADCINB3','ADCINB4'];
const C49 = ['GPIO0','GPIO1','GPIO2','GPIO3','GPIO4','GPIO5','GPIO6','GPIO7','GPIO8','GPIO9','GPIO10','GPIO11','GPIO12','GPIO13','GPIO16','GPIO17','GPIO24','GPIO32','GPIO33','GPIO35','GPIO37','GPIO39','GPIO40','GPIO56','GPIO57','GPIO58','GPIO59','A0','A1','A2','A3','A4','A5','B0','B1','B2'];
const c79 = (mcu, core, flash, ram, tool) => base({ mcu, gpn:mcu, series:'C2000', core, mhz:200, flash, ram, pkg:'LQFP-176', prog: tool ? 'XDS100v2' : 'XDS110', dbg: tool ? XDS100 : XDS110, pinStyle:'c2000',
  header:hdr(C79), adc:['ADCINA0','ADCINA1','ADCINA2','ADCINA3','ADCINB2','ADCINB3','ADCINB4'], i2c:{ bus:'I2CA', inst:'I2CA', scl:'GPIO105', sda:'GPIO104' },
  leds:[['LED1','GPIO31','blue',true], ['LED2','GPIO34','red',true]], btn:null, vcp:['SCIA','GPIO42','GPIO43'], adcDrv:'c2000', adcInst:'ADCA' }, 'c2000', tool);
const c49 = (mcu, mhz, flash, ram, pkg, tool) => base({ mcu, gpn:mcu, series:'C2000', core:'C28x + CLA', mhz, flash, ram, pkg, prog:'XDS110', dbg:XDS110, pinStyle:'c2000',
  header:hdr(C49), adc:['A0','A1','A2','A3','A4','A5','B0','B1','B2'], i2c:{ bus:'I2CA', inst:'I2CA', scl:'GPIO37', sda:'GPIO35' },
  leds:[['LED4','GPIO23','red',true], ['LED5','GPIO34','green',true]], btn:null, vcp:['SCIA','GPIO29','GPIO28'], adcDrv:'c2000', adcInst:'ADCA' }, 'c2000', tool);

export const TI_BOARDS = [
  m0g('MSPM0G3507', 128, 32, { tool:'LP-MSPM0G3507' }),
  m0g('MSPM0G3506', 64, 32), m0g('MSPM0G3505', 32, 16), m0g('MSPM0G1507', 128, 32), m0g('MSPM0G1506', 64, 32), m0g('MSPM0G1505', 32, 16),
  m0g('MSPM0G3107', 128, 32), m0g('MSPM0G3106', 64, 32), m0g('MSPM0G3519', 512, 128, { pkg:'LQFP-100' }),
  m0l('MSPM0L1306', 32, 64, 4, 'VQFN-32'), m0l('MSPM0L1305', 32, 32, 4, 'VQFN-32'), m0l('MSPM0L1304', 32, 16, 2, 'VQFN-32'),
  m0l('MSPM0L1106', 32, 64, 4, 'VQFN-32'), m0l('MSPM0L1105', 32, 32, 4, 'VQFN-32'), m0l('MSPM0L2228', 32, 256, 32, 'LQFP-80'), m0l('MSPM0H3216', 32, 64, 8, 'LQFP-48', { core:'Cortex-M0+（5 V）' }),

  fr2355('MSP430FR2355', 24, 32, 4, 'MSP-EXP430FR2355'), fr2355('MSP430FR2353', 24, 16, 2), fr2355('MSP430FR2155', 24, 32, 4), fr2355('MSP430FR2153', 24, 16, 2), fr2355('MSP430FR2476', 16, 64, 8),
  msp({ mcu:'MSP430FR2433', tool:'MSP-EXP430FR2433', mhz:16, flash:15.5, ram:4, pkg:'VQFN-24', gpio:['P1.2','P1.3','P1.6','P1.7','P2.0','P2.1','P2.2','P2.4','P2.5','P2.6','P3.0','P3.1','P3.2'], adc:['P1.6','P1.7'],
    i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P1.3', sda:'P1.2' }, leds:[['LED1','P1.0','red'], ['LED2','P1.1','green']], btn:['S1','P2.3',true], vcp:['eUSCI_A0','P1.4','P1.5'], adcDrv:'ADC', adcBits:10 }),
  msp({ mcu:'MSP430FR2311', tool:'MSP-EXP430FR2311', mhz:16, flash:3.75, ram:1, pkg:'TSSOP-20', gpio:['P1.2','P1.3','P1.4','P1.5','P2.1','P2.2','P2.3','P2.4','P2.5','P2.6','P2.7'], adc:['P1.4','P1.5'],
    i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P1.3', sda:'P1.2' }, leds:[['LED1','P1.0','red'], ['LED2','P2.0','green']], btn:['S1','P1.1',true], vcp:['eUSCI_A0','P1.7','P1.6'], adcDrv:'ADC', adcBits:10 }),
  msp({ mcu:'MSP430FR4133', tool:'MSP-EXP430FR4133', mhz:16, flash:15.5, ram:2, pkg:'LQFP-64', gpio:['P1.3','P1.4','P1.5','P1.6','P1.7','P2.0','P2.1','P2.2','P2.3','P2.4','P2.5','P2.7','P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7','P4.1','P4.2','P4.3','P4.4','P4.5','P4.6','P4.7','P5.0','P5.1','P5.2','P5.3','P8.0','P8.1','P8.2','P8.3'],
    adc:['P1.3','P1.4','P1.5','P1.6','P1.7','P8.0','P8.1'], i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P5.3', sda:'P5.2' }, leds:[['LED1','P1.0','red'], ['LED2','P4.0','green']], btn:['S1','P1.2',true], vcp:['eUSCI_A0','P1.0','P1.1'], adcDrv:'ADC', adcBits:10 }),
  msp({ mcu:'MSP430FR5969', tool:'MSP-EXP430FR5969', mhz:16, flash:64, ram:2, pkg:'VQFN-48', gpio:['P1.2','P1.3','P1.4','P1.5','P1.6','P1.7','P2.2','P2.3','P2.4','P2.5','P2.6','P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7','P4.0','P4.1','P4.2','P4.3','P4.4','P4.7'],
    adc:['P1.2','P1.3','P1.4','P1.5','P4.2','P4.3'], i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P1.7', sda:'P1.6' }, leds:[['LED1','P4.6','red'], ['LED2','P1.0','green']], btn:['S1','P4.5',true], vcp:['eUSCI_A0','P2.0','P2.1'], adcDrv:'ADC12_B' }),
  msp({ mcu:'MSP430FR5994', tool:'MSP-EXP430FR5994', mhz:16, flash:256, ram:8, pkg:'LQFP-80', gpio:['P1.2','P1.3','P1.4','P1.5','P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7','P4.0','P4.1','P4.2','P4.3','P5.0','P5.1','P5.2','P5.3','P6.0','P6.1','P6.2','P6.3','P7.0','P7.1','P7.2','P7.3','P8.0','P8.1','P8.2','P8.3'],
    adc:['P1.2','P1.3','P1.4','P1.5','P3.0','P3.1','P3.2','P3.3'], i2c:{ bus:'eUSCI_B2', inst:'EUSCI_B2', drv:'EUSCI_B', scl:'P7.1', sda:'P7.0' }, leds:[['LED1','P1.0','red'], ['LED2','P1.1','green']], btn:['S1','P5.6',true], vcp:['eUSCI_A0','P2.0','P2.1'], adcDrv:'ADC12_B' }),
  msp({ mcu:'MSP430FR6989', tool:'MSP-EXP430FR6989', mhz:16, flash:128, ram:2, pkg:'LQFP-100', gpio:['P1.3','P1.4','P1.5','P1.6','P1.7','P2.0','P2.1','P2.2','P2.3','P2.6','P2.7','P3.0','P3.1','P3.2','P3.3','P3.6','P3.7','P4.0','P4.1','P4.2','P4.3','P8.4','P8.5','P8.6','P8.7','P9.0','P9.1','P9.2','P9.3','P9.4','P9.5','P9.6','P10.0','P10.1'],
    adc:['P8.4','P8.5','P8.6','P8.7','P9.0','P9.1','P9.2','P9.3'], i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P1.7', sda:'P1.6' }, leds:[['LED1','P1.0','red'], ['LED2','P9.7','green']], btn:['S1','P1.1',true], vcp:['eUSCI_A1','P3.4','P3.5'], adcDrv:'ADC12_B' }),
  msp({ mcu:'MSP430FR5739', tool:'MSP-EXP430FR5739', mhz:24, flash:16, ram:1, pkg:'VQFN-40', gpio:['P1.0','P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7','P2.2','P2.3','P2.4','P2.5','P2.6','P2.7','P3.0','P3.1','P3.2','P3.3','P4.1'],
    adc:['P1.0','P1.1','P1.2','P1.3','P1.4','P1.5'], i2c:{ bus:'eUSCI_B0', inst:'EUSCI_B0', drv:'EUSCI_B', scl:'P1.7', sda:'P1.6' }, leds:[['LED1','PJ.0','blue'], ['LED2','PJ.1','blue'], ['LED5','P3.4','blue'], ['LED6','P3.5','blue']], btn:['S1','P4.0',true], vcp:['eUSCI_A0','P2.0','P2.1'], adcDrv:'ADC10_B', adcBits:10 }),
  msp({ mcu:'MSP430F5529', tool:'MSP-EXP430F5529LP', mhz:25, flash:128, ram:8, pkg:'LQFP-80', gpio:['P1.2','P1.3','P1.4','P1.5','P1.6','P2.0','P2.2','P2.4','P2.5','P2.6','P2.7','P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P4.0','P4.1','P4.2','P4.3','P6.0','P6.1','P6.2','P6.3','P6.4','P6.5','P6.6','P7.0','P8.1','P8.2'],
    adc:['P6.0','P6.1','P6.2','P6.3','P6.4','P6.5','P6.6'], i2c:{ bus:'USCI_B1', inst:'USCI_B1', drv:'USCI_B', scl:'P4.2', sda:'P4.1' }, leds:[['LED1','P1.0','red'], ['LED2','P4.7','green']], btn:['S2','P1.1',true], vcp:['USCI_A1','P4.4','P4.5'], adcDrv:'ADC12_A' }),

  tm123('TM4C123GH6PM', 'LQFP-64', 'EK-TM4C123GXL'), tm123('TM4C123GH6PZ', 'LQFP-100'),
  tm129('TM4C1294NCPDT', 1024, 'TQFP-128', 'EK-TM4C1294XL'), tm129('TM4C1294KCPDT', 512, 'TQFP-128'), tm129('TM4C129ENCPDT', 1024, 'TQFP-128', 'EK-TM4C129EXL'), tm129('TM4C129XNCZAD', 1024, 'BGA-212'),

  c79('TMS320F28379D', 'C28x ×2 + CLA', 1024, 204, 'LAUNCHXL-F28379D'), c79('TMS320F28379S', 'C28x + CLA', 1024, 164), c79('TMS320F28377S', 'C28x + CLA', 1024, 164), c79('TMS320F28388D', 'C28x ×2 + CLA + Cortex-M4', 1536, 228),
  c49('TMS320F280049C', 100, 256, 100, 'LQFP-100', 'LAUNCHXL-F280049C'), c49('TMS320F280039C', 120, 384, 69, 'LQFP-100'), c49('TMS320F280025C', 100, 128, 24, 'LQFP-64'),
];
