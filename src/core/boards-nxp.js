// NXP 晶片：Kinetis、MCX、LPC、i.MX RT（MCUXpresso SDK）
// kind 'official'：依官方 FRDM／LPCXpresso／EVK 使用手冊；'eval'：模擬器通用評估板
import { makeBoard, PWR } from './board-kit.js';

const hdr = gpio => { const h = [...PWR, ...gpio, ...PWR]; if (h.length % 2) h.push('GND'); return h; };
const ARD = ['A0','A1','A2','A3','A4','A5','D0','D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13','D14','D15'];
const FRDM = 0x1e2a3a, EVK = 0x1c3324, EVAL = 0x22303c;
const DOCS = { MK64FN1M0VLL12:'K64P144M120SF5', MK66FN2M0VMD18:'K66P144M180SF5V2', MKL25Z128VLK4:'KL25P80M48SF0', MKL46Z256VLL4:'KL46P121M48SF4', LPC55S69JBD100:'LPC55S6x', LPC845M301JBD48:'LPC84x',
  LPC824M201JHI33:'LPC82X', LPC812M101JDH20:'LPC81XM', MIMXRT1062DVL6B:'IMXRT1060CEC', MIMXRT1052DVL6B:'IMXRT1050CEC', MIMXRT1011DAE5A:'IMXRT1010CEC', MIMXRT1064DVL6A:'IMXRT1064CEC', MIMXRT1021DAG5A:'IMXRT1020CEC', MIMXRT1176DVMAA:'IMXRT1170CEC', MIMXRT1015DAF5A:'IMXRT1015CEC' };
const links = (mcu, board) => [
  DOCS[mcu] ? { label:`${mcu} Datasheet（PDF）`, url:`https://www.nxp.com/docs/en/data-sheet/${DOCS[mcu]}.pdf` } : { label:`在 NXP 網站搜尋 ${mcu} 的 datasheet`, url:`https://www.nxp.com/search?keyword=${encodeURIComponent(mcu)}` },
  { label:'NXP 產品資料（參考手冊、勘誤表）', url:`https://www.nxp.com/search?keyword=${encodeURIComponent(mcu.replace(/V\w+$/, ''))}` },
  ...(board ? [{ label:`${board} 使用手冊與電路圖`, url:`https://www.nxp.com/search?keyword=${encodeURIComponent(board)}` }] : []),
  { label:'MCUXpresso SDK（建立與下載 SDK）', url:'https://mcuxpresso.nxp.com/' },
];
const OPENSDA = { name:'OpenSDA', part:'MK20DX128VFM5', desc:'板上的 OpenSDA 除錯器，負責 SWD 燒錄與 UART 虛擬序列埠。', url:'https://www.nxp.com/design/design-center/software/sensor-toolbox/opensda-serial-and-debug-adapter:OPENSDA' };
const LINK2 = { name:'LPC-Link2', part:'LPC4322', desc:'板上的 LPC-Link2 除錯器（CMSIS-DAP），負責 SWD 燒錄與虛擬序列埠。', url:'https://www.nxp.com/search?keyword=LPC-Link2' };
const MCULINK = { name:'MCU-Link', part:'LPC55S69', desc:'板上的 MCU-Link 除錯器（CMSIS-DAP），負責 SWD 燒錄與虛擬序列埠。', url:'https://www.nxp.com/search?keyword=MCU-Link' };
const LDO = { part:'MIC5205-3.3', desc:'3.3 V 低壓降穩壓器，最大 150 mA。', url:'https://www.google.com/search?q=MIC5205+datasheet+pdf' };
const EVAL_NOTE = '模擬器通用評估板：晶片腳位名稱與周邊功能依 datasheet，LED、按鈕與 I2C／UART 的接法是本模擬器的設定（參考同系列 FRDM／EVK），不是官方開發板。';
const nxp = (o, board) => makeBoard({ vendor:'NXP', sdk:'mcux', kind: board ? 'official' : 'eval', note: board ? null : EVAL_NOTE, ldo:LDO, ...o,
  id:o.mcu.toLowerCase(), name: board || `${o.mcu} 評估板`, form: board ? (o.form || 'frdm') : 'eval', pcb: board ? (o.pcb || FRDM) : EVAL, links:links(o.mcu, board) });

/* ---------- Kinetis K（FRDM-K64F 的 Arduino 腳位） ---------- */
const K64 = { A0:'PTB2', A1:'PTB3', A2:'PTB10', A3:'PTB11', A4:'PTC11', A5:'PTC10', D0:'PTC16', D1:'PTC17', D2:'PTB9', D3:'PTA1', D4:'PTB23', D5:'PTA2', D6:'PTC2', D7:'PTC3', D8:'PTA0', D9:'PTC4', D10:'PTD0', D11:'PTD2', D12:'PTD3', D13:'PTD1', D14:'PTE25', D15:'PTE24' };
const kk = (mcu, core, mhz, flash, ram, pkg, board) => nxp({ mcu, series:'Kinetis', core, mhz, flash, ram, pkg, prog:'OpenSDA', dbg:OPENSDA, pinStyle:'kinetis',
  header:[...PWR, ...ARD, 'PTC5', 'PTC7', 'PTC0', 'PTC9', 'PTC8', 'PTC1', 'PTB19', 'PTB18', 'PTA25', 'PTA24', ...PWR], pins:K64,
  adc:['PTB2', 'PTB3', 'PTB10', 'PTB11', 'PTC11', 'PTC10'], i2c:{ bus:'I2C0', inst:'I2C0', scl:'D15', sda:'D14' },
  leds:[['LEDR','PTB22','red',true], ['LEDG','PTE26','green',true], ['LEDB','PTB21','blue',true]], btn:['SW2','PTC6',true], vcp:['UART0','PTB17','PTB16'],
  adcDrv:'adc16', adcInst:'ADC0', spi:{ bus:'SPI0', inst:'SPI0', drv:'dspi', sck:'D13', miso:'D12', mosi:'D11', cs:'D10' },
  ...(/^MK6[46]/.test(mcu) ? { can:{ bus:'FlexCAN0', inst:'CAN0', drv:'flexcan', tx:'PTB18', rx:'PTB19' } } : { noCan:`${mcu.slice(0, 4)} 沒有 CAN 控制器（Kinetis K64、K66 才有 FlexCAN）。` }) }, board);
/* ---------- Kinetis L／MCX C（FRDM-KL25Z 的 Arduino 腳位） ---------- */
const KL25 = { A0:'PTB0', A1:'PTB1', A2:'PTB2', A3:'PTB3', A4:'PTC2', A5:'PTC1', D0:'PTA1', D1:'PTA2', D2:'PTD4', D3:'PTA12', D4:'PTA4', D5:'PTA5', D6:'PTC8', D7:'PTC9', D8:'PTA13', D9:'PTD5', D10:'PTD0', D11:'PTD2', D12:'PTD3', D13:'PTD1', D14:'PTE0', D15:'PTE1' };
const kl = (mcu, series, mhz, flash, ram, pkg, board) => nxp({ mcu, series, core:'Cortex-M0+', mhz, flash, ram, pkg, prog:'OpenSDA', dbg:OPENSDA, pinStyle:'kinetis',
  header:[...PWR, ...ARD, 'PTC7', 'PTC0', 'PTC3', 'PTC4', 'PTC5', 'PTC6', 'PTC10', 'PTC11', 'PTE20', 'PTE21', ...PWR], pins:KL25,
  adc:['PTB0', 'PTB1', 'PTB2', 'PTB3', 'PTC2', 'PTC1', 'PTE20', 'PTE21'], i2c:{ bus:'I2C1', inst:'I2C1', scl:'D15', sda:'D14' },
  leds:[['LEDR','PTB18','red',true], ['LEDG','PTB19','green',true], ['LEDB','PTD1','blue',true]], btn:null, vcp:['UART0','PTA2','PTA1'],
  adcDrv:'adc16', adcInst:'ADC0', spi:{ bus:'SPI0', inst:'SPI0', drv:'spi', sck:'D13', miso:'D12', mosi:'D11', cs:'D10' }, noCan:`${series === 'MCX' ? 'MCX C' : 'Kinetis L'} 系列沒有 CAN 控制器。` }, board);
/* ---------- LPC55／LPC54（LPCXpresso55S69 腳位） ---------- */
const L55 = ['PIO0_1','PIO0_2','PIO0_3','PIO0_4','PIO0_5','PIO0_6','PIO0_7','PIO0_8','PIO0_9','PIO0_10','PIO0_15','PIO0_16','PIO0_17','PIO0_18','PIO0_19','PIO0_20','PIO0_21','PIO0_22','PIO0_23','PIO0_26','PIO0_27','PIO0_28','PIO0_31','PIO1_0','PIO1_1','PIO1_2','PIO1_3','PIO1_5','PIO1_8','PIO1_10','PIO1_11','PIO1_12','PIO1_13','PIO1_14','PIO1_20','PIO1_21'];
const l55 = (mcu, series, core, mhz, flash, ram, board, adcDrv = 'lpadc') => nxp({ mcu, series, core, mhz, flash, ram, pkg:'HLQFP-100', prog:'LPC-Link2', dbg:LINK2, pinStyle:'lpc',
  header:hdr(L55), adc:['PIO0_16', 'PIO0_23', 'PIO0_10', 'PIO0_15', 'PIO1_8', 'PIO0_31'], i2c:{ bus:'Flexcomm4 I2C', inst:'I2C4', scl:'PIO1_20', sda:'PIO1_21' },
  leds:[['LEDR','PIO1_6','red',true], ['LEDG','PIO1_7','green',true], ['LEDB','PIO1_4','blue',true]], btn:['USER','PIO1_9',true], vcp:['Flexcomm0','PIO0_30','PIO0_29'],
  adcDrv, adcInst:'ADC0', form:'frdm', spi:{ bus:'Flexcomm8 HS-SPI', inst:'SPI8', drv:'spi', sck:'PIO1_2', miso:'PIO1_3', mosi:'PIO0_26', cs:'PIO1_1' },
  noCan: /^LPC55S?(1|0)|^LPC5462/.test(mcu) ? `${mcu} 有 CAN FD（MCAN 周邊），但模擬器目前還沒有支援。` : `${mcu} 沒有 CAN 控制器。` }, board);
/* ---------- LPC800（LPC845-BRK 腳位；I2C0 為固定的開汲極腳） ---------- */
const L84 = ['PIO0_0','PIO0_1','PIO0_6','PIO0_7','PIO0_8','PIO0_9','PIO0_10','PIO0_11','PIO0_12','PIO0_13','PIO0_14','PIO0_15','PIO0_16','PIO0_17','PIO0_18','PIO0_19','PIO0_20','PIO0_21','PIO0_22','PIO0_23','PIO0_26','PIO0_27','PIO0_28','PIO0_29','PIO0_30','PIO0_31','PIO1_3','PIO1_4','PIO1_5','PIO1_6','PIO1_7'];
const l8 = (mcu, mhz, flash, ram, pkg, board) => nxp({ mcu, series:'LPC800', core:'Cortex-M0+', mhz, flash, ram, pkg, prog:'CMSIS-DAP', dbg:{ ...LINK2, name:'CMSIS-DAP', part:'LPC11U35' }, pinStyle:'lpc',
  header:hdr(L84), adc:['PIO0_7', 'PIO0_6', 'PIO0_14', 'PIO0_23', 'PIO0_22', 'PIO0_21', 'PIO0_20', 'PIO0_19', 'PIO0_18', 'PIO0_17', 'PIO0_13'], i2c:{ bus:'I2C0', inst:'I2C0', scl:'PIO0_10', sda:'PIO0_11' },
  leds:[['LEDG','PIO1_0','green',true], ['LEDB','PIO1_1','blue',true], ['LEDR','PIO1_2','red',true]], btn:['USER','PIO0_4',true], vcp:['USART0','PIO0_25','PIO0_24'],
  adcDrv:'lpcadc', adcInst:'ADC0', form:'frdm', spi:{ bus:'SPI0（開關矩陣）', inst:'SPI0', drv:'spi', sck:'PIO0_26', mosi:'PIO0_27', miso:'PIO0_28', cs:'PIO0_29' }, noCan:'LPC800 系列沒有 CAN 控制器。' }, board);
/* ---------- i.MX RT（跨界 MCU，外部 Flash） ---------- */
const RT = ['GPIO1_IO02','GPIO1_IO03','GPIO1_IO10','GPIO1_IO11','GPIO1_IO16','GPIO1_IO17','GPIO1_IO18','GPIO1_IO19','GPIO1_IO20','GPIO1_IO21','GPIO1_IO22','GPIO1_IO23','GPIO1_IO24','GPIO1_IO25','GPIO1_IO26','GPIO1_IO27','GPIO1_IO28','GPIO1_IO29','GPIO1_IO30','GPIO1_IO31','GPIO2_IO16','GPIO2_IO17','GPIO2_IO18','GPIO2_IO19','GPIO2_IO20','GPIO2_IO21','GPIO2_IO22','GPIO2_IO23','GPIO3_IO00','GPIO3_IO01','GPIO3_IO02','GPIO3_IO03','GPIO4_IO00','GPIO4_IO01','GPIO4_IO02','GPIO4_IO03'];
const rt = (mcu, core, mhz, ram, pkg, board) => nxp({ mcu, series:'i.MX RT', core, mhz, flash:0, ram, pkg, prog:'MCU-Link', dbg:MCULINK, pinStyle:'imxrt',
  header:hdr(RT), adc:['GPIO1_IO26', 'GPIO1_IO27', 'GPIO1_IO20', 'GPIO1_IO21', 'GPIO1_IO22', 'GPIO1_IO23'], i2c:{ bus:'LPI2C1', inst:'LPI2C1', scl:'GPIO1_IO16', sda:'GPIO1_IO17' },
  leds:[['USER','GPIO1_IO09','green',true]], btn:['SW8','GPIO5_IO00',true], vcp:['LPUART1','GPIO1_IO12','GPIO1_IO13'], adcDrv:'rtadc', adcInst:'ADC1', adcCh:15, form:'evk', pcb:EVK,
  spi:{ bus:'LPSPI3', inst:'LPSPI3', drv:'lpspi', sck:'GPIO1_IO00', mosi:'GPIO1_IO01', miso:'GPIO1_IO02', cs:'GPIO1_IO03' },
  ...(/^MIMXRT101/.test(mcu) ? { noCan:'i.MX RT1010／RT1015 沒有 CAN 控制器。' } : { can:{ bus:'FlexCAN1', inst:'CAN1', drv:'flexcan', tx:'GPIO1_IO24', rx:'GPIO1_IO25' } }) }, board);
/* ---------- MCX N／A（Cortex-M33） ---------- */
const MCX = ['P0_4','P0_5','P0_6','P0_7','P0_14','P0_15','P0_16','P0_17','P0_18','P0_19','P0_20','P0_21','P0_22','P0_24','P0_25','P0_26','P1_0','P1_1','P1_3','P1_4','P1_5','P1_6','P1_7','P1_10','P1_11','P1_12','P1_13','P2_0','P2_1','P2_2','P2_3','P3_0','P3_1','P3_2','P4_0','P4_1'];
const mcx = (mcu, series, core, mhz, flash, ram, pkg) => nxp({ mcu, series, core, mhz, flash, ram, pkg, prog:'MCU-Link', dbg:MCULINK, pinStyle:'mcx',
  header:hdr(MCX), adc:['P0_14', 'P0_15', 'P0_16', 'P0_22', 'P0_24', 'P1_10'], i2c:{ bus:'LPI2C2', inst:'LPI2C2', scl:'P4_1', sda:'P4_0' },
  leds:[['LEDR','P0_10','red',true], ['LEDG','P0_27','green',true], ['LEDB','P1_2','blue',true]], btn:['SW2','P0_23',true], vcp:['LPUART4','P1_9','P1_8'], adcDrv:'lpadc', adcInst:'ADC0',
  spi:{ bus:'LPSPI1', inst:'LPSPI1', drv:'lpspi', sck:'P3_1', mosi:'P3_0', miso:'P3_2', cs:'P2_0' },
  ...(mcu === 'MCXA153VLH' ? { noCan:'MCX A153 沒有 CAN 控制器。' } : { can:{ bus:'FlexCAN0', inst:'CAN0', drv:'flexcan', tx:'P1_12', rx:'P1_13' } }) });

export const NXP_BOARDS = [
  kk('MK64FN1M0VLL12', 'Cortex-M4F', 120, 1024, 256, 'LQFP-100', 'FRDM-K64F'), kk('MK66FN2M0VMD18', 'Cortex-M4F', 180, 2048, 256, 'MAPBGA-144'),
  kk('MK22FN512VLH12', 'Cortex-M4F', 120, 512, 128, 'LQFP-64'), kk('MK82FN256VLL15', 'Cortex-M4F', 150, 256, 256, 'LQFP-100'), kk('MK28FN2M0VMI15', 'Cortex-M4F', 150, 2048, 1024, 'MAPBGA-169'),
  kl('MKL25Z128VLK4', 'Kinetis', 48, 128, 16, 'LQFP-80', 'FRDM-KL25Z'), kl('MKL26Z128VLH4', 'Kinetis', 48, 128, 16, 'LQFP-64'), kl('MKL27Z64VLH4', 'Kinetis', 48, 64, 16, 'LQFP-64'),
  kl('MKL43Z256VLH4', 'Kinetis', 48, 256, 32, 'LQFP-64'), kl('MKL46Z256VLL4', 'Kinetis', 48, 256, 32, 'LQFP-100'), kl('MKL82Z128VLK7', 'Kinetis', 72, 128, 96, 'LQFP-80'),
  kl('MCXC444VLH', 'MCX', 48, 256, 32, 'LQFP-64'), kl('MCXC242VLH', 'MCX', 48, 64, 16, 'LQFP-64'),
  l55('LPC55S69JBD100', 'LPC', 'Cortex-M33 ×2', 150, 640, 320, 'LPCXpresso55S69'), l55('LPC55S28JBD100', 'LPC', 'Cortex-M33', 150, 512, 256), l55('LPC5528JBD100', 'LPC', 'Cortex-M33', 150, 512, 256),
  l55('LPC55S16JBD100', 'LPC', 'Cortex-M33', 150, 256, 96), l55('LPC5516JBD100', 'LPC', 'Cortex-M33', 150, 256, 96), l55('LPC55S06JBD64', 'LPC', 'Cortex-M33', 96, 256, 96),
  l55('LPC54628J512ET180', 'LPC', 'Cortex-M4F', 220, 512, 200, null, 'lpcadc'), l55('LPC54114J256BD64', 'LPC', 'Cortex-M4F + M0+', 100, 256, 192, null, 'lpcadc'),
  l8('LPC845M301JBD48', 30, 64, 16, 'LQFP-48', 'LPC845-BRK'), l8('LPC844M201JBD48', 30, 64, 8, 'LQFP-48'), l8('LPC824M201JHI33', 30, 32, 8, 'HVQFN-33'), l8('LPC812M101JDH20', 30, 16, 4, 'TSSOP-20'), l8('LPC804M101JDH24', 15, 32, 4, 'TSSOP-24'),
  rt('MIMXRT1062DVL6B', 'Cortex-M7', 600, 1024, 'MAPBGA-196', 'MIMXRT1060-EVKB'), rt('MIMXRT1064DVL6A', 'Cortex-M7', 600, 1024, 'MAPBGA-196'), rt('MIMXRT1052DVL6B', 'Cortex-M7', 600, 512, 'MAPBGA-196'),
  rt('MIMXRT1021DAG5A', 'Cortex-M7', 500, 256, 'LQFP-144'), rt('MIMXRT1015DAF5A', 'Cortex-M7', 500, 128, 'LQFP-100'), rt('MIMXRT1011DAE5A', 'Cortex-M7', 500, 128, 'LQFP-80'), rt('MIMXRT1176DVMAA', 'Cortex-M7 + M4', 1000, 2048, 'MAPBGA-289'),
  mcx('MCXN947VDF', 'MCX', 'Cortex-M33 ×2', 150, 2048, 512, 'VFBGA-184'), mcx('MCXN236VDF', 'MCX', 'Cortex-M33', 150, 1024, 256, 'VFBGA-184'), mcx('MCXA153VLH', 'MCX', 'Cortex-M33', 96, 128, 32, 'LQFP-64'), mcx('MCXA156VLL', 'MCX', 'Cortex-M33', 96, 1024, 128, 'LQFP-100'),
];
