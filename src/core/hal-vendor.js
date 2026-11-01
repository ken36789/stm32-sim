// TI 與 NXP SDK 的模擬：MSPM0 DriverLib、MSP430 DriverLib、TivaWare、C2000Ware driverlib、MCUXpresso SDK。
// 只實作常用的 GPIO、延遲、I2C、ADC 與輸出函式；其他同前綴的設定函式由編譯器以「略過」處理。
import { SIM, readPin, i2cFind, adcRead, bench } from './sim.js';

/** ctx：{ chk, sleep, outputs, print } */
export function vendorAPI(ctx){
  const { chk, sleep, outputs, print } = ctx;
  const clk = () => bench.board.mhz * 1e6;
  const wait = async sec => { chk(); const end = performance.now() + sec * 1000; do { await sleep(Math.max(0, Math.min(end - performance.now(), 100))); chk(); } while (performance.now() < end); };
  const write = (pin, v) => { SIM.mode[pin] = 'out'; SIM.out[pin] = v ? 1 : 0; };
  const toggle = pin => { SIM.mode[pin] = 'out'; SIM.out[pin] = SIM.out[pin] ? 0 : 1; };
  const read = pin => { if (!SIM.mode[pin]){ SIM.mode[pin] = 'in'; outputs(); } return readPin(pin); };
  const bits = mask => { const o = []; for (let b = 0; b < 32; b++) if ((mask >>> 0) & (2 ** b)) o.push(b); return o; };
  const scale = n => Math.round(adcRead() / 4095 * (2 ** n - 1));
  const onBus = inst => inst && inst.name === bench.board.i2c.inst;
  const dev = (inst, addr) => { if (!onBus(inst)) return null; const d = i2cFind((addr >>> 0) & 0x7F); return d && d !== 'conflict' ? d.dev : null; };
  const tx = (inst, addr, bytes) => { const d = dev(inst, addr); return !!(d && d.tx(bytes.map(b => b & 0xFF))); };
  const rx = (inst, addr, n) => { const d = dev(inst, addr); return d ? d.rx(n) : null; };
  const st = o => o.__i2c || (o.__i2c = { addr:0, recv:false, buf:[], rxq:[], nak:false, cur:0, count:0, mode:0 });
  const obj = (names, mk) => Object.fromEntries(names.map(n => [n, mk(n)]));
  const api = {};

  /* ---- MSPM0 DriverLib ---- */
  const pa = (port, mask) => bits(mask).map(b => `P${port.port}${b}`);
  Object.assign(api, {
    DL_GPIO_setPins:(p, m) => { chk(); pa(p, m).forEach(x => write(x, 1)); outputs(); },
    DL_GPIO_clearPins:(p, m) => { chk(); pa(p, m).forEach(x => write(x, 0)); outputs(); },
    DL_GPIO_togglePins:(p, m) => { chk(); pa(p, m).forEach(toggle); outputs(); },
    DL_GPIO_readPins:(p, m) => { chk(); return bits(m).reduce((acc, b) => acc + (read(`P${p.port}${b}`) ? 2 ** b : 0), 0); },
    delay_cycles:n => wait((Number(n) || 0) / clk()),
    DL_I2C_fillControllerTXFIFO:(i, buf, len) => { chk(); st(i).buf = Array.from({ length:len }, (_, k) => buf[k] ?? 0); return len; },
    DL_I2C_startControllerTransfer:(i, addr, dir, len) => {
      chk(); const s = st(i);
      if (dir === 1){ const d = rx(i, addr, len); s.nak = !d; s.rxq = d ? [...d] : Array(len).fill(0xFF); }
      else { s.nak = !tx(i, addr, s.buf); s.buf = []; }
    },
    DL_I2C_getControllerStatus:i => 0x20 | (st(i).nak ? 0x02 : 0),
    DL_I2C_isControllerRXFIFOEmpty:i => st(i).rxq.length === 0 && !st(i).nak,
    DL_I2C_receiveControllerData:i => st(i).rxq.shift() ?? 0xFF,
    DL_ADC12_startConversion:() => chk(), DL_ADC12_getMemResult:() => { chk(); return scale(12); },
    DL_I2C_CONTROLLER_DIRECTION_TX:0, DL_I2C_CONTROLLER_DIRECTION_RX:1, DL_I2C_CONTROLLER_STATUS_IDLE:0x20, DL_I2C_CONTROLLER_STATUS_BUSY_BUS:0x40, DL_I2C_CONTROLLER_STATUS_ERROR:0x02, DL_ADC12_MEM_IDX_0:0,
  });
  for (let b = 0; b < 32; b++) api['DL_GPIO_PIN_' + b] = 2 ** b;

  /* ---- MSP430 DriverLib ---- */
  const mp = (port, mask) => bits(mask).map(b => `P${port}.${b}`);
  for (let p = 1; p <= 11; p++) api['GPIO_PORT_P' + p] = p;
  api.GPIO_PORT_PJ = 'J';
  for (let b = 0; b < 8; b++) api['GPIO_PIN' + b] = 1 << b;
  Object.assign(api, {
    GPIO_setOutputHighOnPin:(p, m) => { chk(); mp(p, m).forEach(x => write(x, 1)); outputs(); },
    GPIO_setOutputLowOnPin:(p, m) => { chk(); mp(p, m).forEach(x => write(x, 0)); outputs(); },
    GPIO_toggleOutputOnPin:(p, m) => { chk(); mp(p, m).forEach(toggle); outputs(); },
    GPIO_getInputPinValue:(p, m) => { chk(); return read(mp(p, m)[0]) ? 1 : 0; },
    __delay_cycles:n => wait((Number(n) || 0) / clk()),
    GPIO_INPUT_PIN_HIGH:1, GPIO_INPUT_PIN_LOW:0,
    ADC_getResults:() => { chk(); return scale(bench.board.adcBits); }, ADC_isBusy:() => 0, ADC_startConversion:() => chk(),
    ADC12_B_getResults:() => { chk(); return scale(12); }, ADC12_B_isBusy:() => 0, ADC12_B_startConversion:() => chk(),
    ADC12_A_getResults:() => { chk(); return scale(12); }, ADC12_A_isBusy:() => 0, ADC12_A_startConversion:() => chk(),
    ADC10_B_getResults:() => { chk(); return scale(10); }, ADC10_B_isBusy:() => 0, ADC10_B_startConversion:() => chk(),
    ADC_BUSY:1, ADC_NOTBUSY:0,
  });
  for (const P of ['EUSCI_B', 'USCI_B']){
    const rs = b => { const s = st(b); const d = rx(b, s.addr, 16); s.nak = !d; s.rxq = d ? [...d] : []; };
    Object.assign(api, {
      [`${P}_I2C_setSlaveAddress`]:(b, a) => { st(b).addr = a; },
      [`${P}_I2C_setMode`]:(b, m) => { st(b).mode = m; },
      [`${P}_I2C_masterSendSingleByte`]:(b, x) => { chk(); st(b).nak = !tx(b, st(b).addr, [x]); },
      [`${P}_I2C_masterSendMultiByteStart`]:(b, x) => { chk(); st(b).buf = [x]; },
      [`${P}_I2C_masterSendMultiByteNext`]:(b, x) => { st(b).buf.push(x); },
      [`${P}_I2C_masterSendMultiByteFinish`]:(b, x) => { const s = st(b); s.buf.push(x); s.nak = !tx(b, s.addr, s.buf); },
      [`${P}_I2C_masterSendMultiByteStop`]:b => { const s = st(b); s.nak = !tx(b, s.addr, s.buf); },
      [`${P}_I2C_masterReceiveStart`]:b => { chk(); rs(b); },
      [`${P}_I2C_masterReceiveMultiByteStart`]:b => { chk(); rs(b); },
      [`${P}_I2C_masterReceiveMultiByteNext`]:b => st(b).rxq.shift() ?? 0xFF,
      [`${P}_I2C_masterReceiveMultiByteFinish`]:b => st(b).rxq.shift() ?? 0xFF,
      [`${P}_I2C_masterReceiveSingleByte`]:b => { rs(b); return st(b).rxq.shift() ?? 0xFF; },
      [`${P}_I2C_getInterruptStatus`]:(b, m) => st(b).nak ? (m & 0x20) : 0,
      [`${P}_I2C_clearInterrupt`]:b => { st(b).nak = false; },
      [`${P}_I2C_NAK_INTERRUPT`]:0x20, [`${P}_I2C_TRANSMIT_MODE`]:0x10, [`${P}_I2C_RECEIVE_MODE`]:0x00,
    });
  }
  Object.assign(api, obj(['EUSCI_B0_BASE', 'EUSCI_B1_BASE', 'EUSCI_B2_BASE', 'EUSCI_B3_BASE', 'USCI_B0_BASE', 'USCI_B1_BASE'], n => ({ name:n.replace('_BASE', '') })));

  /* ---- TivaWare ---- */
  'ABCDEFGHJKLMNPQ'.split('').forEach(p => { api[`GPIO_PORT${p}_BASE`] = { port:p }; });
  Object.assign(api, {
    GPIOPinWrite:(p, m, v) => { chk(); bits(m).forEach(b => write(`P${p.port}${b}`, v & (1 << b))); outputs(); },
    GPIOPinRead:(p, m) => { chk(); return bits(m).reduce((acc, b) => acc + (read(`P${p.port}${b}`) ? 1 << b : 0), 0); },
    SysCtlClockGet:() => clk(), SysCtlClockFreqSet:() => clk(), SysCtlPeripheralReady:() => true,
    SysCtlDelay:n => wait((Number(n) || 0) * 3 / clk()),
    I2CMasterSlaveAddrSet:(b, a, r) => { const s = st(b); s.addr = a; s.recv = !!r; },
    I2CMasterDataPut:(b, x) => { st(b).cur = x; },
    I2CMasterControl:(b, cmd) => {
      chk(); const s = st(b);
      if (!s.recv){
        if (cmd === 0x07){ s.nak = !tx(b, s.addr, [s.cur]); }
        else if (cmd === 0x03){ s.buf = [s.cur]; }
        else if (cmd === 0x01){ s.buf.push(s.cur); }
        else if (cmd === 0x05){ s.buf.push(s.cur); s.nak = !tx(b, s.addr, s.buf); }
      } else {
        if (cmd === 0x07 || cmd === 0x0B){ const d = rx(b, s.addr, cmd === 0x07 ? 1 : 16); s.nak = !d; s.rxq = d ? [...d] : []; }
        s.cur = s.rxq.shift() ?? 0xFF;
      }
    },
    I2CMasterBusy:() => false, I2CMasterBusBusy:() => false, I2CMasterErr:b => st(b).nak ? 0x04 : 0, I2CMasterDataGet:b => st(b).cur,
    I2C_MASTER_CMD_SINGLE_SEND:0x07, I2C_MASTER_CMD_SINGLE_RECEIVE:0x07, I2C_MASTER_CMD_BURST_SEND_START:0x03, I2C_MASTER_CMD_BURST_SEND_CONT:0x01, I2C_MASTER_CMD_BURST_SEND_FINISH:0x05,
    I2C_MASTER_CMD_BURST_RECEIVE_START:0x0B, I2C_MASTER_CMD_BURST_RECEIVE_CONT:0x09, I2C_MASTER_CMD_BURST_RECEIVE_FINISH:0x05, I2C_MASTER_ERR_NONE:0, I2C_MASTER_ERR_ADDR_ACK:0x04,
    ADCProcessorTrigger:() => chk(), ADCIntStatus:() => 1, ADCSequenceDataGet:(b, s, buf) => { chk(); if (buf) buf[0] = scale(12); return 1; },
    UARTprintf:(f, ...a) => print(f, a),
  });
  Object.assign(api, obj(['I2C0_BASE', 'I2C1_BASE', 'I2C2_BASE', 'I2C3_BASE'], n => ({ name:n.replace('_BASE', '') })), obj(['ADC0_BASE', 'ADC1_BASE'], n => ({ name:n.replace('_BASE', '') })));

  /* ---- C2000Ware driverlib ---- */
  const c2s = b => { const s = st(b); return s; };
  Object.assign(api, {
    GPIO_writePin:(p, v) => { chk(); write(`GPIO${p}`, v); outputs(); },
    GPIO_togglePin:p => { chk(); toggle(`GPIO${p}`); outputs(); },
    GPIO_readPin:p => { chk(); return read(`GPIO${p}`) ? 1 : 0; },
    DEVICE_DELAY_US:us => wait((Number(us) || 0) / 1e6),
    I2C_setTargetAddress:(b, a) => { c2s(b).addr = a; }, I2C_setSlaveAddress:(b, a) => { c2s(b).addr = a; },
    I2C_setDataCount:(b, n) => { c2s(b).count = n; }, I2C_putData:(b, x) => { c2s(b).buf.push(x); }, I2C_setConfig:(b, m) => { c2s(b).mode = m; },
    I2C_sendStartCondition:b => {
      chk(); const s = c2s(b);
      if ((s.mode & 0x0200)){ s.nak = !tx(b, s.addr, s.buf); s.buf = []; }
      else { const d = rx(b, s.addr, s.count || 1); s.nak = !d; s.rxq = d ? [...d] : []; }
    },
    I2C_sendStopCondition:() => {}, I2C_isBusBusy:() => false, I2C_getStopConditionStatus:() => false,
    I2C_getStatus:b => c2s(b).nak ? 0x0002 : 0, I2C_getData:b => c2s(b).rxq.shift() ?? 0xFF,
    I2C_CONTROLLER_SEND_MODE:0x0600, I2C_CONTROLLER_RECEIVE_MODE:0x0400, I2C_MASTER_SEND_MODE:0x0600, I2C_MASTER_RECEIVE_MODE:0x0400, I2C_STS_NO_ACK:0x0002,
    ADC_forceSOC:() => chk(), ADC_getInterruptStatus:() => true, ADC_readResult:() => { chk(); return scale(12); },
    I2CA_BASE:{ name:'I2CA' }, I2CB_BASE:{ name:'I2CB' }, ADCA_BASE:{ name:'ADCA' }, ADCARESULT_BASE:{ name:'ADCA' }, ADC_SOC_NUMBER0:0, ADC_INT_NUMBER1:0,
  });

  /* ---- NXP MCUXpresso SDK ---- */
  const nx = (base, a, b) => {
    const s = bench.board.pinStyle;
    if (base?.lpc) return `PIO${a}_${b}`;
    if (base?.port) return `PT${base.port}${a}`;
    if (base?.inst !== undefined) return s === 'imxrt' ? `GPIO${base.inst}_IO${String(a).padStart(2, '0')}` : `P${base.inst}_${a}`;
    return '?';
  };
  for (let i = 0; i <= 13; i++) api['GPIO' + i] = { inst:i };
  api.GPIO = { lpc:true };
  Object.assign(api, {
    GPIO_PinWrite:(base, a, b, c) => { chk(); if (base?.lpc) write(nx(base, a, b), c); else write(nx(base, a), b); outputs(); },
    GPIO_PinRead:(base, a, b) => { chk(); return read(base?.lpc ? nx(base, a, b) : nx(base, a)) ? 1 : 0; },
    GPIO_PortToggle:(base, a, b) => { chk(); if (base?.lpc) bits(b).forEach(k => toggle(nx(base, a, k))); else bits(a).forEach(k => toggle(nx(base, k))); outputs(); },
    GPIO_PortSet:(base, a, b) => { chk(); if (base?.lpc) bits(b).forEach(k => write(nx(base, a, k), 1)); else bits(a).forEach(k => write(nx(base, k), 1)); outputs(); },
    GPIO_PortClear:(base, a, b) => { chk(); if (base?.lpc) bits(b).forEach(k => write(nx(base, a, k), 0)); else bits(a).forEach(k => write(nx(base, k), 0)); outputs(); },
    SDK_DelayAtLeastUs:us => wait((Number(us) || 0) / 1e6),
    I2C_MasterStart:(b, a, d) => { const s = st(b); s.addr = a; s.recv = d === 1; return 0; },
    I2C_MasterWriteBlocking:(b, data, len) => { chk(); return tx(b, st(b).addr, Array.from({ length:len }, (_, k) => data[k] ?? 0)) ? 0 : 1101; },
    I2C_MasterReadBlocking:(b, buf, len) => { chk(); const d = rx(b, st(b).addr, len); if (!d) return 1101; d.forEach((x, k) => { buf[k] = x; }); return 0; },
    I2C_MasterStop:() => 0,
    LPI2C_MasterStart:(b, a, d) => { const s = st(b); s.addr = a; s.recv = d === 1; return 0; },
    LPI2C_MasterSend:(b, data, len) => { chk(); return tx(b, st(b).addr, Array.from({ length:len }, (_, k) => data[k] ?? 0)) ? 0 : 905; },
    LPI2C_MasterReceive:(b, buf, len) => { chk(); const d = rx(b, st(b).addr, len); if (!d) return 905; d.forEach((x, k) => { buf[k] = x; }); return 0; },
    LPI2C_MasterStop:() => 0,
    kI2C_Write:0, kI2C_Read:1, kLPI2C_Write:0, kLPI2C_Read:1, kStatus_Success:0, kI2C_TransferDefaultFlag:0,
    ADC16_GetChannelStatusFlags:() => 1, ADC16_GetChannelConversionValue:() => { chk(); return scale(12); }, kADC16_ChannelConversionDoneFlag:1,
    LPADC_GetConvResult:(b, res) => { chk(); if (res && typeof res === 'object') res.convValue = scale(12) << 3; return true; },
    ADC_GetChannelConversionResult:(b, ch, info) => { chk(); if (info && typeof info === 'object') info.result = scale(12); return true; },
    ADC_GetChannelStatusFlags:() => 1, ADC_GetChannelConversionValue:() => { chk(); return scale(12); },
    PRINTF:(f, ...a) => print(f, a),
  });
  Object.assign(api, obj(['I2C0', 'I2C1', 'I2C2', 'I2C3', 'I2C4', 'LPI2C0', 'LPI2C1', 'LPI2C2', 'LPI2C3', 'LPI2C4', 'ADC0', 'ADC1'], n => ({ name:n })));
  // 範例程式會呼叫的初始化與設定函式（模擬器中不需要動作）
  for (const f of NOOPS) if (!(f in api)) api[f] = () => { chk(); return 0; };
  return api;
}

const NOOPS = ['SYSCFG_DL_init', 'WDT_A_hold', 'PMM_unlockLPM5', 'GPIO_setAsOutputPin', 'GPIO_setAsInputPinWithPullUpResistor', 'GPIO_setAsInputPinWithPullDownResistor', 'GPIO_setAsPeripheralModuleFunctionInputPin',
  'EUSCI_B_I2C_initMaster', 'EUSCI_B_I2C_enable', 'USCI_B_I2C_initMaster', 'USCI_B_I2C_enable', 'SysCtlClockSet', 'SysCtlPeripheralEnable', 'GPIOPinTypeGPIOOutput', 'GPIOPinTypeGPIOInput', 'GPIOPadConfigSet',
  'GPIOPinConfigure', 'GPIOPinTypeI2CSCL', 'GPIOPinTypeI2C', 'GPIOPinTypeADC', 'I2CMasterInitExpClk', 'ADCSequenceConfigure', 'ADCSequenceStepConfigure', 'ADCSequenceEnable', 'ADCIntClear', 'UARTStdioConfig',
  'Device_init', 'Device_initGPIO', 'Interrupt_initModule', 'Interrupt_initVectorTable', 'GPIO_setPadConfig', 'GPIO_setDirectionMode', 'GPIO_setPinConfig', 'GPIO_setQualificationMode', 'I2C_initController', 'I2C_enableModule',
  'ADC_setupSOC', 'ADC_setInterruptSource', 'ADC_enableInterrupt', 'ADC_clearInterruptStatus', 'BOARD_InitBootPins', 'BOARD_InitBootClocks', 'BOARD_InitDebugConsole', 'BOARD_InitPins', 'GPIO_PortInit', 'GPIO_PinInit',
  'ADC16_SetChannelConfig', 'LPADC_DoSoftwareTrigger', 'ADC_DoSoftwareTriggerConvSeqA', 'ADC_SetChannelConfig', 'DL_ADC12_enableConversions', 'CLOCK_EnableClock', 'PORT_SetPinMux', 'IOMUXC_SetPinMux'];

/** 這些前綴的函式若模擬器沒有實作，編譯時給警告，執行時略過並回傳 0 */
export const VENDOR_PREFIX = /^(DL_|SYSCFG_|GPIO_|WDT_|PMM_|CS_|EUSCI_|USCI_|ADC|SysCtl|GPIOPin|IntMaster|I2C|UART|Device_|Interrupt_|SCI_|CLOCK_|BOARD_|PORT_|IOMUXC_|LPI2C_|LPADC_|SDK_|SysTick|NVIC_|Board_|Timer|PWM|SPI_|FLEXCOMM|POWER_|RESET_|CTIMER_|INPUTMUX_|SYSCON_|LPUART_|USART_|EPWM_|CPUTimer_|XBAR_|DMA_|ECAP_|EQEP_|CMPSS_|DAC_)/;
