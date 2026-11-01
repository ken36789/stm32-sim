// 各家 SDK 的範例程式寫法。每個 SDK 提供：腳位定義、輸出／切換／讀取、延遲、初始化、I2C 與 ADC 的程式片段。
const num = s => s.match(/(\d+)$/)[1];

const stm32hal = {
  name:'STM32Cube HAL', print:'printf', float:true,
  includes:() => ['#include "main.h"', '#include <stdio.h>'],
  def:(n, p) => [`#define ${(n + '_Port').padEnd(14)} GPIO${p[1]}`, `#define ${(n + '_Pin').padEnd(14)} GPIO_PIN_${num(p)}`],
  cfgOut:() => [], cfgIn:() => [],
  set:(n, c) => `HAL_GPIO_WritePin(${n}_Port, ${n}_Pin, (${c}) ? GPIO_PIN_SET : GPIO_PIN_RESET);`,
  pin:(n, v) => `HAL_GPIO_WritePin(${n}_Port, ${n}_Pin, GPIO_PIN_${v ? 'SET' : 'RESET'});`,
  tog:n => `HAL_GPIO_TogglePin(${n}_Port, ${n}_Pin);`,
  read:n => `(HAL_GPIO_ReadPin(${n}_Port, ${n}_Pin) == GPIO_PIN_SET)`,
  delay:ms => `HAL_Delay(${ms});`,
  globals:() => [],
  init:(b, u) => ['HAL_Init();', `SystemClock_Config();            // SYSCLK ${b.mhz} MHz`, 'MX_GPIO_Init();', u.i2c && `MX_I2C1_Init();                  // ${b.i2c.bus}`, u.adc && 'MX_ADC1_Init();', `MX_${b.vcp.periph}_UART_Init();`].filter(Boolean),
  i2c:() => `static int I2C_Write(uint8_t addr, uint8_t *data, int len)
{
  return HAL_I2C_Master_Transmit(&hi2c1, addr << 1, data, len, 100) == HAL_OK;
}

static int I2C_Read(uint8_t addr, uint8_t *buf, int len)
{
  return HAL_I2C_Master_Receive(&hi2c1, addr << 1, buf, len, 100) == HAL_OK;
}`,
  adc:() => ['HAL_ADC_Start(&hadc1);', 'HAL_ADC_PollForConversion(&hadc1, 10);', 'uint32_t adc = HAL_ADC_GetValue(&hadc1);'],
  spi:b => ({ init:[`MX_${b.spi.inst}_Init();                  // ${b.spi.bus}：模式 0、MSB 先送、約 1 MHz`], helper:`static void SPI_Xfer(uint8_t *tx, uint8_t *rx, int len)
{
  HAL_SPI_TransmitReceive(&h${b.spi.inst.toLowerCase()}, tx, rx, len, 100);
}` }),
  can:b => {
    const H = b.can.handle;
    if (b.can.drv === 'fdcan') return {
      globals:['FDCAN_TxHeaderTypeDef canTx;', 'FDCAN_RxHeaderTypeDef canRx;', 'uint8_t canTxData[8];', 'uint8_t canRxData[8];'],
      init:['MX_FDCAN1_Init();                // 傳統 CAN 500 kbps', 'canTx.Identifier = CAN_TX_ID;', 'canTx.IdType = FDCAN_STANDARD_ID;', 'canTx.TxFrameType = FDCAN_DATA_FRAME;', 'canTx.DataLength = FDCAN_DLC_BYTES_4;',
        'canTx.ErrorStateIndicator = FDCAN_ESI_ACTIVE;', 'canTx.BitRateSwitch = FDCAN_BRS_OFF;', 'canTx.FDFormat = FDCAN_CLASSIC_CAN;', 'canTx.TxEventFifoControl = FDCAN_NO_TX_EVENTS;', 'canTx.MessageMarker = 0;',
        `HAL_FDCAN_ConfigGlobalFilter(&${H}, FDCAN_ACCEPT_IN_RX_FIFO0, FDCAN_ACCEPT_IN_RX_FIFO0, FDCAN_REJECT_REMOTE, FDCAN_REJECT_REMOTE);   // 接收所有 ID`, `HAL_FDCAN_Start(&${H});`],
      set:(k, e) => `canTxData[${k}] = ${e};`, send:[`HAL_FDCAN_AddMessageToTxFifoQ(&${H}, &canTx, canTxData);`],
      rxPre:[], rxBegin:`while (HAL_FDCAN_GetRxFifoFillLevel(&${H}, FDCAN_RX_FIFO0) > 0) {`, rxRead:[`HAL_FDCAN_GetRxMessage(&${H}, FDCAN_RX_FIFO0, &canRx, canRxData);`], rxPost:[],
      rxId:'canRx.Identifier', rxLen:'canRx.DataLength', rxByte:k => `canRxData[${k}]`,
    };
    return {
      globals:['CAN_TxHeaderTypeDef canTx;', 'CAN_RxHeaderTypeDef canRx;', 'uint8_t canTxData[8];', 'uint8_t canRxData[8];', 'uint32_t canMailbox;'],
      init:[`MX_${b.can.bus}_Init();                  // 500 kbps`, 'CAN_FilterTypeDef filter = {0};', 'filter.FilterBank = 0;', 'filter.FilterMode = CAN_FILTERMODE_IDMASK;', 'filter.FilterScale = CAN_FILTERSCALE_32BIT;',
        'filter.FilterMaskIdHigh = 0;          // 遮罩全部是 0：接收所有 ID', 'filter.FilterMaskIdLow = 0;', 'filter.FilterFIFOAssignment = CAN_RX_FIFO0;', 'filter.FilterActivation = ENABLE;', `HAL_CAN_ConfigFilter(&${H}, &filter);`, `HAL_CAN_Start(&${H});`,
        'canTx.StdId = CAN_TX_ID;', 'canTx.IDE = CAN_ID_STD;', 'canTx.RTR = CAN_RTR_DATA;', 'canTx.DLC = 4;'],
      set:(k, e) => `canTxData[${k}] = ${e};`, send:[`HAL_CAN_AddTxMessage(&${H}, &canTx, canTxData, &canMailbox);`],
      rxPre:[], rxBegin:`while (HAL_CAN_GetRxFifoFillLevel(&${H}, CAN_RX_FIFO0) > 0) {`, rxRead:[`HAL_CAN_GetRxMessage(&${H}, CAN_RX_FIFO0, &canRx, canRxData);`], rxPost:[],
      rxId:'canRx.StdId', rxLen:'canRx.DLC', rxByte:k => `canRxData[${k}]`,
    };
  },
};

const mspm0 = {
  name:'MSPM0 SDK DriverLib', print:'printf', float:true,
  includes:() => ['#include "ti_msp_dl_config.h"   // SysConfig 產生：GPIO、I2C、ADC、UART 設定', '#include <stdio.h>'],
  def:(n, p) => [`#define ${(n + '_PORT').padEnd(14)} GPIO${p[1]}`, `#define ${(n + '_PIN').padEnd(14)} DL_GPIO_PIN_${num(p)}`],
  cfgOut:() => [], cfgIn:() => [],
  set:(n, c) => `if (${c}) DL_GPIO_setPins(${n}_PORT, ${n}_PIN); else DL_GPIO_clearPins(${n}_PORT, ${n}_PIN);`,
  pin:(n, v) => `DL_GPIO_${v ? 'set' : 'clear'}Pins(${n}_PORT, ${n}_PIN);`,
  tog:n => `DL_GPIO_togglePins(${n}_PORT, ${n}_PIN);`,
  read:n => `(DL_GPIO_readPins(${n}_PORT, ${n}_PIN) != 0)`,
  delay:(ms, b) => `delay_cycles(${b.mhz * 1000 * ms});   // ${ms} ms @ ${b.mhz} MHz`,
  globals:() => [],
  init:() => ['SYSCFG_DL_init();'],
  i2c:b => { const I = b.i2c.inst; return `static int I2C_Write(uint8_t addr, uint8_t *data, int len)
{
  DL_I2C_fillControllerTXFIFO(${I}, data, len);
  while (!(DL_I2C_getControllerStatus(${I}) & DL_I2C_CONTROLLER_STATUS_IDLE));
  DL_I2C_startControllerTransfer(${I}, addr, DL_I2C_CONTROLLER_DIRECTION_TX, len);
  while (DL_I2C_getControllerStatus(${I}) & DL_I2C_CONTROLLER_STATUS_BUSY_BUS);
  return !(DL_I2C_getControllerStatus(${I}) & DL_I2C_CONTROLLER_STATUS_ERROR);
}

static int I2C_Read(uint8_t addr, uint8_t *buf, int len)
{
  DL_I2C_startControllerTransfer(${I}, addr, DL_I2C_CONTROLLER_DIRECTION_RX, len);
  if (DL_I2C_getControllerStatus(${I}) & DL_I2C_CONTROLLER_STATUS_ERROR) return 0;
  for (int i = 0; i < len; i++) {
    while (DL_I2C_isControllerRXFIFOEmpty(${I}));
    buf[i] = DL_I2C_receiveControllerData(${I});
  }
  return 1;
}`; },
  adc:b => [`DL_ADC12_startConversion(${b.adcInst});`, `delay_cycles(${b.mhz * 10});`, `uint32_t adc = DL_ADC12_getMemResult(${b.adcInst}, DL_ADC12_MEM_IDX_0);`],
  spi:() => ({ init:[], helper:`// SPI_0_INST 由 SysConfig 設定：控制器模式、模式 0、1 MHz
static void SPI_Xfer(uint8_t *tx, uint8_t *rx, int len)
{
  for (int i = 0; i < len; i++) {
    DL_SPI_transmitDataBlocking8(SPI_0_INST, tx[i]);
    rx[i] = DL_SPI_receiveDataBlocking8(SPI_0_INST);
  }
}` }),
  can:() => ({
    globals:['DL_MCAN_TxBufElement canTx;', 'DL_MCAN_RxBufElement canRx;', 'DL_MCAN_RxFIFOStatus canFifo;'],
    init:['// CANFD0 由 SysConfig 設定成傳統 CAN 500 kbps', 'canTx.id = ((uint32_t)CAN_TX_ID) << 18U;     // 標準 ID 放在 bit 28..18', 'canTx.rtr = 0U;', 'canTx.xtd = 0U;', 'canTx.esi = 0U;', 'canTx.dlc = 4U;', 'canTx.brs = 0U;', 'canTx.fdf = 0U;                         // 傳統 CAN，不是 CAN FD', 'canTx.efc = 0U;', 'canTx.mm = 0U;', 'canFifo.num = DL_MCAN_RX_FIFO_NUM_0;'],
    set:(k, e) => `canTx.data[${k}] = ${e};`, send:['DL_MCAN_writeMsgRam(CANFD0, DL_MCAN_MEM_TYPE_BUF, 0U, &canTx);', 'DL_MCAN_TXBufAddReq(CANFD0, 0U);'],
    rxPre:['DL_MCAN_getRxFIFOStatus(CANFD0, &canFifo);'], rxBegin:'while (canFifo.fillLvl > 0) {', rxRead:['DL_MCAN_readMsgRam(CANFD0, DL_MCAN_MEM_TYPE_FIFO, 0U, canFifo.num, &canRx);', 'DL_MCAN_writeRxFIFOAck(CANFD0, canFifo.num, canFifo.getIdx);'], rxPost:['DL_MCAN_getRxFIFOStatus(CANFD0, &canFifo);'],
    rxId:'(canRx.id >> 18) & 0x7FF', rxLen:'canRx.dlc', rxByte:k => `canRx.data[${k}]`,
  }),
};

const msp430 = {
  name:'MSP430 DriverLib', print:'printf', float:false,
  includes:() => ['#include <driverlib.h>', '#include <stdio.h>', '#include <stdlib.h>'],
  def:(n, p) => { const [port, bit] = p.slice(1).split('.'); return [`#define ${(n + '_PORT').padEnd(14)} GPIO_PORT_P${port}`, `#define ${(n + '_PIN').padEnd(14)} GPIO_PIN${bit}`]; },
  cfgOut:n => [`GPIO_setAsOutputPin(${n}_PORT, ${n}_PIN);`],
  cfgIn:(n, pu) => [`GPIO_setAsInputPinWith${pu ? 'PullUp' : 'PullDown'}Resistor(${n}_PORT, ${n}_PIN);`],
  set:(n, c) => `if (${c}) GPIO_setOutputHighOnPin(${n}_PORT, ${n}_PIN); else GPIO_setOutputLowOnPin(${n}_PORT, ${n}_PIN);`,
  pin:(n, v) => `GPIO_setOutput${v ? 'High' : 'Low'}OnPin(${n}_PORT, ${n}_PIN);`,
  tog:n => `GPIO_toggleOutputOnPin(${n}_PORT, ${n}_PIN);`,
  read:n => `(GPIO_getInputPinValue(${n}_PORT, ${n}_PIN) == GPIO_INPUT_PIN_HIGH)`,
  delay:(ms, b) => `__delay_cycles(${b.mhz * 1000 * ms});   // ${ms} ms @ ${b.mhz} MHz`,
  globals:() => [],
  init:(b, u) => {
    const P = b.i2c.drv, base = `${b.i2c.inst}_BASE`;
    return ['WDT_A_hold(WDT_A_BASE);', ...(/^MSP430FR/.test(b.mcu) ? ['PMM_unlockLPM5();                // FRAM 系列：解除 GPIO 高阻抗鎖定'] : []),
      ...(u.i2c ? [`${P}_I2C_initMasterParam i2cConfig = {0};`, `i2cConfig.dataRate = ${P}_I2C_SET_DATA_RATE_100KBPS;`, `${P}_I2C_initMaster(${base}, &i2cConfig);`, `${P}_I2C_enable(${base});`] : [])];
  },
  i2c:b => { const P = b.i2c.drv, B = `${b.i2c.inst}_BASE`, rs = P === 'USCI_B' ? 'masterReceiveMultiByteStart' : 'masterReceiveStart'; return `static int I2C_Write(uint8_t addr, uint8_t *data, int len)
{
  ${P}_I2C_setSlaveAddress(${B}, addr);
  ${P}_I2C_setMode(${B}, ${P}_I2C_TRANSMIT_MODE);
  ${P}_I2C_clearInterrupt(${B}, ${P}_I2C_NAK_INTERRUPT);
  ${P}_I2C_masterSendMultiByteStart(${B}, data[0]);
  for (int i = 1; i < len; i++) ${P}_I2C_masterSendMultiByteNext(${B}, data[i]);
  ${P}_I2C_masterSendMultiByteStop(${B});
  return !${P}_I2C_getInterruptStatus(${B}, ${P}_I2C_NAK_INTERRUPT);
}

static int I2C_Read(uint8_t addr, uint8_t *buf, int len)
{
  ${P}_I2C_setSlaveAddress(${B}, addr);
  ${P}_I2C_setMode(${B}, ${P}_I2C_RECEIVE_MODE);
  ${P}_I2C_clearInterrupt(${B}, ${P}_I2C_NAK_INTERRUPT);
  ${P}_I2C_${rs}(${B});
  for (int i = 0; i < len - 1; i++) buf[i] = ${P}_I2C_masterReceiveMultiByteNext(${B});
  buf[len - 1] = ${P}_I2C_masterReceiveMultiByteFinish(${B});
  return !${P}_I2C_getInterruptStatus(${B}, ${P}_I2C_NAK_INTERRUPT);
}`; },
  adc:b => {
    const d = b.adcDrv;
    if (d === 'ADC') return ['ADC_startConversion(ADC_BASE, ADC_SINGLECHANNEL);', 'while (ADC_isBusy(ADC_BASE) == ADC_BUSY);', 'uint32_t adc = ADC_getResults(ADC_BASE);'];
    if (d === 'ADC10_B') return ['ADC10_B_startConversion(ADC10_B_BASE, ADC10_B_SINGLECHANNEL);', 'while (ADC10_B_isBusy(ADC10_B_BASE));', 'uint32_t adc = ADC10_B_getResults(ADC10_B_BASE);'];
    return [`${d}_startConversion(${d}_BASE, ${d}_MEMORY_0, ${d}_SINGLECHANNEL);`, `while (${d}_isBusy(${d}_BASE));`, `uint32_t adc = ${d}_getResults(${d}_BASE, ${d}_MEMORY_0);`];
  },
  spi:b => {
    const P = b.spi.drv, B = `${b.spi.inst}_BASE`, eu = P.startsWith('EUSCI');
    const pins = [[b.spi.sck, 'Output'], [b.spi.mosi, 'Output'], [b.spi.miso, 'Input']].map(([p, d]) => { const [port, bit] = p.slice(1).split('.'); return `GPIO_setAsPeripheralModuleFunction${d}Pin(GPIO_PORT_P${port}, GPIO_PIN${bit}, GPIO_PRIMARY_MODULE_FUNCTION);`; });
    return { init:[...pins, `${P}_SPI_initMasterParam spiConfig = {0};`, `spiConfig.selectClockSource = ${P}_SPI_CLOCKSOURCE_SMCLK;`, 'spiConfig.clockSourceFrequency = CS_getSMCLK();', 'spiConfig.desiredSpiClock = 1000000;',
      `spiConfig.msbFirst = ${P}_SPI_MSB_FIRST;`, `spiConfig.clockPhase = ${P}_SPI_PHASE_DATA_CAPTURED_ONFIRST_CHANGED_ON_NEXT;   // 模式 0`, `spiConfig.clockPolarity = ${P}_SPI_CLOCKPOLARITY_INACTIVITY_LOW;`,
      ...(eu ? [`spiConfig.spiMode = ${P}_SPI_3PIN;`] : []), `${P}_SPI_initMaster(${B}, &spiConfig);`, `${P}_SPI_enable(${B});`],
    helper:`static void SPI_Xfer(uint8_t *tx, uint8_t *rx, int len)
{
  for (int i = 0; i < len; i++) {
    while (!${P}_SPI_getInterruptStatus(${B}, ${P}_SPI_TRANSMIT_INTERRUPT));
    ${P}_SPI_transmitData(${B}, tx[i]);
    while (${P}_SPI_isBusy(${B}));
    rx[i] = ${P}_SPI_receiveData(${B});
  }
}` };
  },
};

const tivaware = {
  name:'TivaWare', print:'UARTprintf', float:false,
  includes:(b, u = {}) => ['#include <stdint.h>', '#include <stdbool.h>', '#include <stdlib.h>', '#include "inc/hw_memmap.h"', '#include "driverlib/sysctl.h"', '#include "driverlib/gpio.h"', '#include "driverlib/pin_map.h"', '#include "driverlib/i2c.h"', '#include "driverlib/adc.h"', ...(u.spi ? ['#include "driverlib/ssi.h"'] : []), ...(u.can ? ['#include "driverlib/can.h"'] : []), '#include "utils/uartstdio.h"'],
  def:(n, p) => [`#define ${(n + '_PORT').padEnd(14)} GPIO_PORT${p[1]}_BASE`, `#define ${(n + '_PIN').padEnd(14)} GPIO_PIN_${num(p)}`],
  cfgOut:n => [`GPIOPinTypeGPIOOutput(${n}_PORT, ${n}_PIN);`],
  cfgIn:(n, pu) => [`GPIOPinTypeGPIOInput(${n}_PORT, ${n}_PIN);`, ...(pu ? [`GPIOPadConfigSet(${n}_PORT, ${n}_PIN, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);`] : [])],
  set:(n, c) => `GPIOPinWrite(${n}_PORT, ${n}_PIN, (${c}) ? ${n}_PIN : 0);`,
  pin:(n, v) => `GPIOPinWrite(${n}_PORT, ${n}_PIN, ${v ? `${n}_PIN` : '0'});`,
  tog:n => `GPIOPinWrite(${n}_PORT, ${n}_PIN, GPIOPinRead(${n}_PORT, ${n}_PIN) ^ ${n}_PIN);`,
  read:n => `(GPIOPinRead(${n}_PORT, ${n}_PIN) != 0)`,
  delay:ms => `SysCtlDelay(g_ui32SysClock / 3 / ${Math.round(1000 / ms)});   // ${ms} ms`,
  globals:() => ['uint32_t g_ui32SysClock;'],
  init:(b, u, ports) => [
    b.mhz > 80 ? 'g_ui32SysClock = SysCtlClockFreqSet(SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);'
      : 'SysCtlClockSet(SYSCTL_SYSDIV_2_5 | SYSCTL_USE_PLL | SYSCTL_OSC_MAIN | SYSCTL_XTAL_16MHZ);   // 80 MHz',
    ...(b.mhz > 80 ? [] : ['g_ui32SysClock = SysCtlClockGet();']),
    ...[...ports].sort().map(p => `SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIO${p});`),
    ...(u.i2c ? ['SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);', 'GPIOPinConfigure(GPIO_PB2_I2C0SCL);', 'GPIOPinConfigure(GPIO_PB3_I2C0SDA);', 'GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);', 'GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);', 'I2CMasterInitExpClk(I2C0_BASE, g_ui32SysClock, false);'] : []),
    ...(u.adc ? ['SysCtlPeripheralEnable(SYSCTL_PERIPH_ADC0);', 'ADCSequenceConfigure(ADC0_BASE, 3, ADC_TRIGGER_PROCESSOR, 0);', 'ADCSequenceStepConfigure(ADC0_BASE, 3, 0, ADC_CTL_CH0 | ADC_CTL_IE | ADC_CTL_END);', 'ADCSequenceEnable(ADC0_BASE, 3);'] : []),
    'UARTStdioConfig(0, 115200, g_ui32SysClock);   // UART0 → ICDI 虛擬序列埠',
  ],
  i2c:() => `static int I2C_Write(uint8_t addr, uint8_t *data, int len)
{
  I2CMasterSlaveAddrSet(I2C0_BASE, addr, false);
  I2CMasterDataPut(I2C0_BASE, data[0]);
  if (len == 1) {
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
    while (I2CMasterBusy(I2C0_BASE));
  } else {
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_START);
    while (I2CMasterBusy(I2C0_BASE));
    for (int i = 1; i < len; i++) {
      I2CMasterDataPut(I2C0_BASE, data[i]);
      I2CMasterControl(I2C0_BASE, (i == len - 1) ? I2C_MASTER_CMD_BURST_SEND_FINISH : I2C_MASTER_CMD_BURST_SEND_CONT);
      while (I2CMasterBusy(I2C0_BASE));
    }
  }
  return I2CMasterErr(I2C0_BASE) == I2C_MASTER_ERR_NONE;
}

static int I2C_Read(uint8_t addr, uint8_t *buf, int len)
{
  I2CMasterSlaveAddrSet(I2C0_BASE, addr, true);
  if (len == 1) {
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_RECEIVE);
    while (I2CMasterBusy(I2C0_BASE));
    buf[0] = I2CMasterDataGet(I2C0_BASE);
  } else {
    for (int i = 0; i < len; i++) {
      I2CMasterControl(I2C0_BASE, (i == 0) ? I2C_MASTER_CMD_BURST_RECEIVE_START : ((i == len - 1) ? I2C_MASTER_CMD_BURST_RECEIVE_FINISH : I2C_MASTER_CMD_BURST_RECEIVE_CONT));
      while (I2CMasterBusy(I2C0_BASE));
      buf[i] = I2CMasterDataGet(I2C0_BASE);
    }
  }
  return I2CMasterErr(I2C0_BASE) == I2C_MASTER_ERR_NONE;
}`,
  adc:() => ['uint32_t adcBuf[1];', 'ADCProcessorTrigger(ADC0_BASE, 3);', 'while (!ADCIntStatus(ADC0_BASE, 3, false));', 'ADCIntClear(ADC0_BASE, 3);', 'ADCSequenceDataGet(ADC0_BASE, 3, adcBuf);', 'uint32_t adc = adcBuf[0];'],
  spi:b => {
    const I = b.spi.inst, port = b.spi.sck[1], pins = [b.spi.sck, b.spi.miso, b.spi.mosi].map(p => `GPIO_PIN_${num(p)}`).join(' | ');
    return { init:[`SysCtlPeripheralEnable(SYSCTL_PERIPH_${I});`, `SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIO${port});`, ...b.spi.pcfg.map(c => `GPIOPinConfigure(${c});`), `GPIOPinTypeSSI(GPIO_PORT${port}_BASE, ${pins});`,
      `SSIConfigSetExpClk(${I}_BASE, g_ui32SysClock, SSI_FRF_MOTO_MODE_0, SSI_MODE_MASTER, 1000000, 8);   // 模式 0、1 MHz、8 位元`, `SSIEnable(${I}_BASE);`],
    helper:`static void SPI_Xfer(uint8_t *tx, uint8_t *rx, int len)
{
  uint32_t r[1];
  for (int i = 0; i < len; i++) {
    SSIDataPut(${I}_BASE, tx[i]);
    while (SSIBusy(${I}_BASE));
    SSIDataGet(${I}_BASE, r);
    rx[i] = r[0];
  }
}` };
  },
  can:b => {
    const I = b.can.inst, port = b.can.tx[1];
    return {
      globals:['tCANMsgObject canTx;', 'tCANMsgObject canRx;', 'uint8_t canTxData[8];', 'uint8_t canRxData[8];'],
      init:[`SysCtlPeripheralEnable(SYSCTL_PERIPH_${I});`, `SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIO${port});`, ...b.can.pcfg.map(c => `GPIOPinConfigure(${c});`), `GPIOPinTypeCAN(GPIO_PORT${port}_BASE, GPIO_PIN_${num(b.can.rx)} | GPIO_PIN_${num(b.can.tx)});`,
        `CANInit(${I}_BASE);`, `CANBitRateSet(${I}_BASE, g_ui32SysClock, 500000);`, `CANEnable(${I}_BASE);`,
        'canRx.ui32MsgID = CAN_RX_ID;', 'canRx.ui32MsgIDMask = 0x7FF;', 'canRx.ui32Flags = MSG_OBJ_USE_ID_FILTER;', 'canRx.ui32MsgLen = 8;', `CANMessageSet(${I}_BASE, 2, &canRx, MSG_OBJ_TYPE_RX);   // 訊息物件 2：接收 ID 0x200`,
        'canTx.ui32MsgID = CAN_TX_ID;', 'canTx.ui32MsgIDMask = 0;', 'canTx.ui32Flags = MSG_OBJ_NO_FLAGS;', 'canTx.ui32MsgLen = 4;', 'canTx.pui8MsgData = canTxData;'],
      set:(k, e) => `canTxData[${k}] = ${e};`, send:[`CANMessageSet(${I}_BASE, 1, &canTx, MSG_OBJ_TYPE_TX);   // 訊息物件 1：送出`],
      rxPre:[], rxBegin:`if (CANStatusGet(${I}_BASE, CAN_STS_NEWDAT) & (1 << 1)) {   // 物件 2 收到新資料`, rxRead:['canRx.pui8MsgData = canRxData;', `CANMessageGet(${I}_BASE, 2, &canRx, true);`], rxPost:[],
      rxId:'canRx.ui32MsgID', rxLen:'canRx.ui32MsgLen', rxByte:k => `canRxData[${k}]`,
    };
  },
};

const c2000 = {
  name:'C2000Ware driverlib', print:'printf', float:true,
  includes:() => ['#include "driverlib.h"', '#include "device.h"', '#include <stdio.h>'],
  def:(n, p) => [`#define ${(n + '_PIN').padEnd(14)} ${num(p)}`],
  cfgOut:n => [`GPIO_setPadConfig(${n}_PIN, GPIO_PIN_TYPE_STD);`, `GPIO_setDirectionMode(${n}_PIN, GPIO_DIR_MODE_OUT);`],
  cfgIn:(n, pu) => [`GPIO_setPadConfig(${n}_PIN, ${pu ? 'GPIO_PIN_TYPE_PULLUP' : 'GPIO_PIN_TYPE_STD'});`, `GPIO_setDirectionMode(${n}_PIN, GPIO_DIR_MODE_IN);`],
  set:(n, c) => `GPIO_writePin(${n}_PIN, (${c}) ? 1 : 0);`,
  pin:(n, v) => `GPIO_writePin(${n}_PIN, ${v ? 1 : 0});`,
  tog:n => `GPIO_togglePin(${n}_PIN);`,
  read:n => `(GPIO_readPin(${n}_PIN) == 1)`,
  delay:ms => `DEVICE_DELAY_US(${ms * 1000});`,
  globals:() => [],
  init:(b, u) => ['Device_init();', 'Device_initGPIO();', 'Interrupt_initModule();', 'Interrupt_initVectorTable();',
    ...(u.i2c ? ['I2C_initController(I2CA_BASE, DEVICE_SYSCLK_FREQ, 100000, I2C_DUTYCYCLE_50);', 'I2C_enableModule(I2CA_BASE);'] : []),
    ...(u.adc ? ['ADC_setupSOC(ADCA_BASE, ADC_SOC_NUMBER0, ADC_TRIGGER_SW_ONLY, ADC_CH_ADCIN0, 15);', 'ADC_setInterruptSource(ADCA_BASE, ADC_INT_NUMBER1, ADC_SOC_NUMBER0);', 'ADC_enableInterrupt(ADCA_BASE, ADC_INT_NUMBER1);'] : []),
    'EINT;', 'ERTM;'],
  i2c:() => `static int I2C_Write(uint16_t addr, uint16_t *data, int len)
{
  I2C_setTargetAddress(I2CA_BASE, addr);
  I2C_setDataCount(I2CA_BASE, len);
  for (int i = 0; i < len; i++) I2C_putData(I2CA_BASE, data[i]);
  I2C_setConfig(I2CA_BASE, I2C_CONTROLLER_SEND_MODE);
  I2C_sendStartCondition(I2CA_BASE);
  I2C_sendStopCondition(I2CA_BASE);
  while (I2C_isBusBusy(I2CA_BASE));
  return !(I2C_getStatus(I2CA_BASE) & I2C_STS_NO_ACK);
}

static int I2C_Read(uint16_t addr, uint16_t *buf, int len)
{
  I2C_setTargetAddress(I2CA_BASE, addr);
  I2C_setDataCount(I2CA_BASE, len);
  I2C_setConfig(I2CA_BASE, I2C_CONTROLLER_RECEIVE_MODE);
  I2C_sendStartCondition(I2CA_BASE);
  I2C_sendStopCondition(I2CA_BASE);
  while (I2C_isBusBusy(I2CA_BASE));
  if (I2C_getStatus(I2CA_BASE) & I2C_STS_NO_ACK) return 0;
  for (int i = 0; i < len; i++) buf[i] = I2C_getData(I2CA_BASE);
  return 1;
}`,
  adc:() => ['ADC_forceSOC(ADCA_BASE, ADC_SOC_NUMBER0);', 'while (!ADC_getInterruptStatus(ADCA_BASE, ADC_INT_NUMBER1));', 'ADC_clearInterruptStatus(ADCA_BASE, ADC_INT_NUMBER1);', 'uint32_t adc = ADC_readResult(ADCARESULT_BASE, ADC_SOC_NUMBER0);'],
  spi:b => { const I = b.spi.inst; return { init:[...b.spi.pcfg.map(c => `GPIO_setPinConfig(${c});`), `SPI_disableModule(${I}_BASE);`,
    `SPI_setConfig(${I}_BASE, DEVICE_LSPCLK_FREQ, SPI_PROT_POL0PHA1, SPI_MODE_CONTROLLER, 1000000, 8);   // C2000 的 POL0PHA1 就是一般說的模式 0`, `SPI_disableFIFO(${I}_BASE);`, `SPI_enableModule(${I}_BASE);`],
    helper:`static void SPI_Xfer(uint16_t *tx, uint16_t *rx, int len)
{
  for (int i = 0; i < len; i++) {
    SPI_writeDataBlockingNonFIFO(${I}_BASE, tx[i] << 8);    // 8 位元模式：要送出的資料必須靠左對齊
    rx[i] = SPI_readDataBlockingNonFIFO(${I}_BASE) & 0xFF;  // 收到的資料在低 8 位元
  }
}` }; },
  can:b => { const I = b.can.inst; return {
    globals:['uint16_t canTxData[8];', 'uint16_t canRxData[8];'],
    init:[...b.can.pcfg.map(c => `GPIO_setPinConfig(${c});`), `CAN_initModule(${I}_BASE);`, `CAN_setBitRate(${I}_BASE, DEVICE_SYSCLK_FREQ, 500000, 16);`,
      `CAN_setupMessageObject(${I}_BASE, 1, CAN_TX_ID, CAN_MSG_FRAME_STD, CAN_MSG_OBJ_TYPE_TX, 0, CAN_MSG_OBJ_NO_FLAGS, 4);   // 物件 1：送出`,
      `CAN_setupMessageObject(${I}_BASE, 2, CAN_RX_ID, CAN_MSG_FRAME_STD, CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_NO_FLAGS, 8);   // 物件 2：接收 ID 0x200`, `CAN_startModule(${I}_BASE);`],
    set:(k, e) => `canTxData[${k}] = ${e};`, send:[`CAN_sendMessage(${I}_BASE, 1, 4, canTxData);`],
    rxPre:[], rxBegin:`if (CAN_readMessage(${I}_BASE, 2, canRxData)) {`, rxRead:[], rxPost:[], rxId:'CAN_RX_ID', rxLen:'2', rxByte:k => `canRxData[${k}]`,
  }; },
};

const nxpRef = (b, p) => {
  if (b.pinStyle === 'lpc'){ const m = p.match(/^PIO(\d+)_(\d+)$/); return { port:m[1], pin:m[2] }; }
  if (b.pinStyle === 'imxrt'){ const m = p.match(/^GPIO(\d+)_IO(\d+)$/); return { gpio:`GPIO${m[1]}`, pin:+m[2] }; }
  if (b.pinStyle === 'mcx'){ const m = p.match(/^P(\d+)_(\d+)$/); return { gpio:`GPIO${m[1]}`, pin:m[2] }; }
  const m = p.match(/^PT([A-E])(\d+)$/); return { gpio:`GPIO${m[1]}`, pin:m[2] };
};
const mcux = b => {
  const lpc = b.pinStyle === 'lpc', lp = /^LPI2C/.test(b.i2c.inst), I = b.i2c.inst, pre = lp ? 'LPI2C_' : 'I2C_', S = lp ? 'kLPI2C' : 'kI2C';
  const send = lp ? `LPI2C_MasterSend(${I}, data, len)` : `I2C_MasterWriteBlocking(${I}, data, len, kI2C_TransferDefaultFlag)`;
  const recv = lp ? `LPI2C_MasterReceive(${I}, buf, len)` : `I2C_MasterReadBlocking(${I}, buf, len, kI2C_TransferDefaultFlag)`;
  return {
    name:'MCUXpresso SDK', print:'PRINTF', float:false,
    includes:(bb, u = {}) => ['#include "fsl_device_registers.h"', '#include "fsl_debug_console.h"', '#include "fsl_gpio.h"', `#include "${lp ? 'fsl_lpi2c.h' : 'fsl_i2c.h'}"`, ...(u.spi && b.spi ? [`#include "fsl_${b.spi.drv}.h"`] : []), ...(u.can ? ['#include "fsl_flexcan.h"'] : []), `#include "${{ adc16:'fsl_adc16.h', lpadc:'fsl_lpadc.h', lpcadc:'fsl_adc.h', rtadc:'fsl_adc.h' }[b.adcDrv]}"`, '#include "pin_mux.h"', '#include "clock_config.h"', '#include "board.h"', '#include <stdlib.h>'],
    def:(n, p) => { const r = nxpRef(b, p); return lpc ? [`#define ${(n + '_PORT').padEnd(14)} ${r.port}U`, `#define ${(n + '_PIN').padEnd(14)} ${r.pin}U`] : [`#define ${(n + '_GPIO').padEnd(14)} ${r.gpio}`, `#define ${(n + '_PIN').padEnd(14)} ${r.pin}U`]; },
    cfgOut:n => [lpc ? `GPIO_PinInit(GPIO, ${n}_PORT, ${n}_PIN, &outConfig);` : `GPIO_PinInit(${n}_GPIO, ${n}_PIN, &outConfig);`],
    cfgIn:n => [lpc ? `GPIO_PinInit(GPIO, ${n}_PORT, ${n}_PIN, &inConfig);` : `GPIO_PinInit(${n}_GPIO, ${n}_PIN, &inConfig);`],
    set:(n, c) => lpc ? `GPIO_PinWrite(GPIO, ${n}_PORT, ${n}_PIN, (${c}) ? 1U : 0U);` : `GPIO_PinWrite(${n}_GPIO, ${n}_PIN, (${c}) ? 1U : 0U);`,
    pin:(n, v) => lpc ? `GPIO_PinWrite(GPIO, ${n}_PORT, ${n}_PIN, ${v ? 1 : 0}U);` : `GPIO_PinWrite(${n}_GPIO, ${n}_PIN, ${v ? 1 : 0}U);`,
    tog:n => lpc ? `GPIO_PortToggle(GPIO, ${n}_PORT, 1U << ${n}_PIN);` : `GPIO_PortToggle(${n}_GPIO, 1U << ${n}_PIN);`,
    read:n => lpc ? `(GPIO_PinRead(GPIO, ${n}_PORT, ${n}_PIN) == 1U)` : `(GPIO_PinRead(${n}_GPIO, ${n}_PIN) == 1U)`,
    delay:ms => `SDK_DelayAtLeastUs(${ms * 1000}U, SDK_DEVICE_MAXIMUM_CPU_CLOCK_FREQUENCY);`,
    globals:() => ['gpio_pin_config_t outConfig = {kGPIO_DigitalOutput, 0};', 'gpio_pin_config_t inConfig = {kGPIO_DigitalInput, 0};'],
    init:() => ['BOARD_InitBootPins();', 'BOARD_InitBootClocks();', 'BOARD_InitDebugConsole();', ...(lpc ? ['GPIO_PortInit(GPIO, 0U);', 'GPIO_PortInit(GPIO, 1U);'] : [])],
    i2c:() => `static int I2C_Write(uint8_t addr, uint8_t *data, int len)
{
  if (${pre}MasterStart(${I}, addr, ${S}_Write) != kStatus_Success) return 0;
  status_t st = ${send};
  ${pre}MasterStop(${I});
  return st == kStatus_Success;
}

static int I2C_Read(uint8_t addr, uint8_t *buf, int len)
{
  if (${pre}MasterStart(${I}, addr, ${S}_Read) != kStatus_Success) return 0;
  status_t st = ${recv};
  ${pre}MasterStop(${I});
  return st == kStatus_Success;
}`,
    adc:() => ({
      adc16:['adc16_channel_config_t ch;', `ch.channelNumber = ${b.adcCh}U;`, 'ch.enableInterruptOnConversionCompleted = false;', `ADC16_SetChannelConfig(${b.adcInst}, 0U, &ch);`, `while (!(ADC16_GetChannelStatusFlags(${b.adcInst}, 0U) & kADC16_ChannelConversionDoneFlag));`, `uint32_t adc = ADC16_GetChannelConversionValue(${b.adcInst}, 0U);`],
      lpadc:['lpadc_conv_result_t res;', `LPADC_DoSoftwareTrigger(${b.adcInst}, 1U);`, `while (!LPADC_GetConvResult(${b.adcInst}, &res, 0U));`, 'uint32_t adc = res.convValue >> 3;'],
      lpcadc:['adc_result_info_t info;', `ADC_DoSoftwareTriggerConvSeqA(${b.adcInst});`, `while (!ADC_GetChannelConversionResult(${b.adcInst}, ${b.adcCh}U, &info));`, 'uint32_t adc = info.result;'],
      rtadc:['adc_channel_config_t ch;', `ch.channelNumber = ${b.adcCh}U;`, 'ch.enableInterruptOnConversionCompleted = false;', `ADC_SetChannelConfig(${b.adcInst}, 0U, &ch);`, `while (!ADC_GetChannelStatusFlags(${b.adcInst}, 0U));`, `uint32_t adc = ADC_GetChannelConversionValue(${b.adcInst}, 0U);`],
    })[b.adcDrv],
    spi:() => {
      const I = b.spi.inst, d = b.spi.drv, clk = b.pinStyle === 'kinetis' ? 'CLOCK_GetFreq(kCLOCK_BusClk)' : 'CLOCK_GetFreq(kCLOCK_MainClk)';
      const init = d === 'dspi' ? ['dspi_master_config_t spiCfg;', 'DSPI_MasterGetDefaultConfig(&spiCfg);', 'spiCfg.ctarConfig.baudRate = 1000000U;      // 模式 0（預設）、1 MHz', `DSPI_MasterInit(${I}, &spiCfg, ${clk});`]
        : d === 'lpspi' ? ['lpspi_master_config_t spiCfg;', 'LPSPI_MasterGetDefaultConfig(&spiCfg);', 'spiCfg.baudRate = 1000000U;                 // 模式 0（預設）、1 MHz', `LPSPI_MasterInit(${I}, &spiCfg, ${clk});`]
        : ['spi_master_config_t spiCfg;', 'SPI_MasterGetDefaultConfig(&spiCfg);', 'spiCfg.baudRate_Bps = 1000000U;             // 模式 0（預設）、1 MHz', `SPI_MasterInit(${I}, &spiCfg, ${clk});`];
      const T = { dspi:['dspi_transfer_t', 'kDSPI_MasterCtar0 | kDSPI_MasterPcsContinuous', 'DSPI'], lpspi:['lpspi_transfer_t', 'kLPSPI_MasterPcs0 | kLPSPI_MasterPcsContinuous', 'LPSPI'], spi:['spi_transfer_t', 'kSPI_FrameAssert', 'SPI'] }[d];
      return { init, helper:`static void SPI_Xfer(uint8_t *tx, uint8_t *rx, int len)
{
  ${T[0]} xfer;
  xfer.txData = tx;
  xfer.rxData = rx;
  xfer.dataSize = len;
  xfer.configFlags = ${T[1]};
  ${T[2]}_MasterTransferBlocking(${I}, &xfer);
}` };
    },
    can:() => { const I = b.can.inst; return {
      globals:['flexcan_config_t canCfg;', 'flexcan_rx_mb_config_t canRxCfg;', 'flexcan_frame_t canTx;', 'flexcan_frame_t canRx;'],
      init:['FLEXCAN_GetDefaultConfig(&canCfg);', 'canCfg.bitRate = 500000U;', `FLEXCAN_Init(${I}, &canCfg, CLOCK_GetFreq(kCLOCK_BusClk));`, `FLEXCAN_SetTxMbConfig(${I}, 9, true);           // 信箱 9：送出`,
        'canRxCfg.id = FLEXCAN_ID_STD(CAN_RX_ID);', 'canRxCfg.format = kFLEXCAN_FrameFormatStandard;', 'canRxCfg.type = kFLEXCAN_FrameTypeData;', `FLEXCAN_SetRxMbConfig(${I}, 10, &canRxCfg, true);   // 信箱 10：接收 ID 0x200`,
        'canTx.format = kFLEXCAN_FrameFormatStandard;', 'canTx.type = kFLEXCAN_FrameTypeData;', 'canTx.id = FLEXCAN_ID_STD(CAN_TX_ID);', 'canTx.length = 4;'],
      set:(k, e) => `canTx.dataByte${k} = ${e};`, send:[`FLEXCAN_TransferSendBlocking(${I}, 9, &canTx);`],
      rxPre:[], rxBegin:`if (FLEXCAN_GetMbStatusFlags(${I}, 1U << 10)) {`, rxRead:[`FLEXCAN_ClearMbStatusFlags(${I}, 1U << 10);`, `FLEXCAN_ReadRxMb(${I}, 10, &canRx);`], rxPost:[],
      rxId:'(canRx.id >> 18) & 0x7FF', rxLen:'canRx.length', rxByte:k => `canRx.dataByte${k}`,
    }; },
  };
};

export function sdkFor(b){ return b.sdk === 'mcux' ? mcux(b) : { stm32hal, mspm0, msp430, tivaware, c2000 }[b.sdk]; }
export const SDK_NAMES = { stm32hal:'STM32Cube HAL', mspm0:'MSPM0 SDK DriverLib', msp430:'MSP430 DriverLib', tivaware:'TivaWare', c2000:'C2000Ware driverlib', mcux:'MCUXpresso SDK' };
