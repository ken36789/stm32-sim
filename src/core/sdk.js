// 各家 SDK 的範例程式寫法。每個 SDK 提供：腳位定義、輸出／切換／讀取、延遲、初始化、I2C 與 ADC 的程式片段。
const num = s => s.match(/(\d+)$/)[1];

const stm32hal = {
  name:'STM32Cube HAL', print:'printf', float:true,
  includes:() => ['#include "main.h"', '#include <stdio.h>'],
  def:(n, p) => [`#define ${(n + '_Port').padEnd(14)} GPIO${p[1]}`, `#define ${(n + '_Pin').padEnd(14)} GPIO_PIN_${num(p)}`],
  cfgOut:() => [], cfgIn:() => [],
  set:(n, c) => `HAL_GPIO_WritePin(${n}_Port, ${n}_Pin, (${c}) ? GPIO_PIN_SET : GPIO_PIN_RESET);`,
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
};

const mspm0 = {
  name:'MSPM0 SDK DriverLib', print:'printf', float:true,
  includes:() => ['#include "ti_msp_dl_config.h"   // SysConfig 產生：GPIO、I2C、ADC、UART 設定', '#include <stdio.h>'],
  def:(n, p) => [`#define ${(n + '_PORT').padEnd(14)} GPIO${p[1]}`, `#define ${(n + '_PIN').padEnd(14)} DL_GPIO_PIN_${num(p)}`],
  cfgOut:() => [], cfgIn:() => [],
  set:(n, c) => `if (${c}) DL_GPIO_setPins(${n}_PORT, ${n}_PIN); else DL_GPIO_clearPins(${n}_PORT, ${n}_PIN);`,
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
};

const msp430 = {
  name:'MSP430 DriverLib', print:'printf', float:false,
  includes:() => ['#include <driverlib.h>', '#include <stdio.h>', '#include <stdlib.h>'],
  def:(n, p) => { const [port, bit] = p.slice(1).split('.'); return [`#define ${(n + '_PORT').padEnd(14)} GPIO_PORT_P${port}`, `#define ${(n + '_PIN').padEnd(14)} GPIO_PIN${bit}`]; },
  cfgOut:n => [`GPIO_setAsOutputPin(${n}_PORT, ${n}_PIN);`],
  cfgIn:(n, pu) => [`GPIO_setAsInputPinWith${pu ? 'PullUp' : 'PullDown'}Resistor(${n}_PORT, ${n}_PIN);`],
  set:(n, c) => `if (${c}) GPIO_setOutputHighOnPin(${n}_PORT, ${n}_PIN); else GPIO_setOutputLowOnPin(${n}_PORT, ${n}_PIN);`,
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
};

const tivaware = {
  name:'TivaWare', print:'UARTprintf', float:false,
  includes:() => ['#include <stdint.h>', '#include <stdbool.h>', '#include <stdlib.h>', '#include "inc/hw_memmap.h"', '#include "driverlib/sysctl.h"', '#include "driverlib/gpio.h"', '#include "driverlib/pin_map.h"', '#include "driverlib/i2c.h"', '#include "driverlib/adc.h"', '#include "utils/uartstdio.h"'],
  def:(n, p) => [`#define ${(n + '_PORT').padEnd(14)} GPIO_PORT${p[1]}_BASE`, `#define ${(n + '_PIN').padEnd(14)} GPIO_PIN_${num(p)}`],
  cfgOut:n => [`GPIOPinTypeGPIOOutput(${n}_PORT, ${n}_PIN);`],
  cfgIn:(n, pu) => [`GPIOPinTypeGPIOInput(${n}_PORT, ${n}_PIN);`, ...(pu ? [`GPIOPadConfigSet(${n}_PORT, ${n}_PIN, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);`] : [])],
  set:(n, c) => `GPIOPinWrite(${n}_PORT, ${n}_PIN, (${c}) ? ${n}_PIN : 0);`,
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
};

const c2000 = {
  name:'C2000Ware driverlib', print:'printf', float:true,
  includes:() => ['#include "driverlib.h"', '#include "device.h"', '#include <stdio.h>'],
  def:(n, p) => [`#define ${(n + '_PIN').padEnd(14)} ${num(p)}`],
  cfgOut:n => [`GPIO_setPadConfig(${n}_PIN, GPIO_PIN_TYPE_STD);`, `GPIO_setDirectionMode(${n}_PIN, GPIO_DIR_MODE_OUT);`],
  cfgIn:(n, pu) => [`GPIO_setPadConfig(${n}_PIN, ${pu ? 'GPIO_PIN_TYPE_PULLUP' : 'GPIO_PIN_TYPE_STD'});`, `GPIO_setDirectionMode(${n}_PIN, GPIO_DIR_MODE_IN);`],
  set:(n, c) => `GPIO_writePin(${n}_PIN, (${c}) ? 1 : 0);`,
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
    includes:() => ['#include "fsl_device_registers.h"', '#include "fsl_debug_console.h"', '#include "fsl_gpio.h"', `#include "${lp ? 'fsl_lpi2c.h' : 'fsl_i2c.h'}"`, `#include "${{ adc16:'fsl_adc16.h', lpadc:'fsl_lpadc.h', lpcadc:'fsl_adc.h', rtadc:'fsl_adc.h' }[b.adcDrv]}"`, '#include "pin_mux.h"', '#include "clock_config.h"', '#include "board.h"', '#include <stdlib.h>'],
    def:(n, p) => { const r = nxpRef(b, p); return lpc ? [`#define ${(n + '_PORT').padEnd(14)} ${r.port}U`, `#define ${(n + '_PIN').padEnd(14)} ${r.pin}U`] : [`#define ${(n + '_GPIO').padEnd(14)} ${r.gpio}`, `#define ${(n + '_PIN').padEnd(14)} ${r.pin}U`]; },
    cfgOut:n => [lpc ? `GPIO_PinInit(GPIO, ${n}_PORT, ${n}_PIN, &outConfig);` : `GPIO_PinInit(${n}_GPIO, ${n}_PIN, &outConfig);`],
    cfgIn:n => [lpc ? `GPIO_PinInit(GPIO, ${n}_PORT, ${n}_PIN, &inConfig);` : `GPIO_PinInit(${n}_GPIO, ${n}_PIN, &inConfig);`],
    set:(n, c) => lpc ? `GPIO_PinWrite(GPIO, ${n}_PORT, ${n}_PIN, (${c}) ? 1U : 0U);` : `GPIO_PinWrite(${n}_GPIO, ${n}_PIN, (${c}) ? 1U : 0U);`,
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
  };
};

export function sdkFor(b){ return b.sdk === 'mcux' ? mcux(b) : { stm32hal, mspm0, msp430, tivaware, c2000 }[b.sdk]; }
export const SDK_NAMES = { stm32hal:'STM32Cube HAL', mspm0:'MSPM0 SDK DriverLib', msp430:'MSP430 DriverLib', tivaware:'TivaWare', c2000:'C2000Ware driverlib', mcux:'MCUXpresso SDK' };
