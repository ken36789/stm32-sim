// TI 與 NXP SDK 的模擬：MSPM0 DriverLib、MSP430 DriverLib、TivaWare、C2000Ware driverlib、MCUXpresso SDK。
// 只實作常用的 GPIO、延遲、I2C、ADC 與輸出函式；其他同前綴的設定函式由編譯器以「略過」處理。
import { SIM, readPin, adcRead, bench, pinWrite, pinToggle } from './sim.js';
import { i2cWrite, i2cRead, i2cPrefetch, i2cTraceRead, spiTransfer, CAN, canSend, canPending, canRecv } from './buses.js';

/** ctx：{ chk, sleep, outputs, print } */
export function vendorAPI(ctx){
  const { chk, sleep, outputs, print } = ctx;
  const clk = () => bench.board.mhz * 1e6;
  const wait = async sec => { chk(); const end = performance.now() + sec * 1000; do { await sleep(Math.max(0, Math.min(end - performance.now(), 100))); chk(); } while (performance.now() < end); };
  const write = (pin, v) => pinWrite(pin, v);
  const toggle = pin => pinToggle(pin);
  const read = pin => { if (!SIM.mode[pin]){ SIM.mode[pin] = 'in'; outputs(); } return readPin(pin); };
  const bits = mask => { const o = []; for (let b = 0; b < 32; b++) if ((mask >>> 0) & (2 ** b)) o.push(b); return o; };
  const scale = n => Math.round(adcRead() / 4095 * (2 ** n - 1));
  const onBus = inst => inst && inst.name === bench.board.i2c.inst;
  const tx = (inst, addr, bytes) => onBus(inst) && i2cWrite((addr >>> 0) & 0x7F, bytes);
  const rx = (inst, addr, n) => onBus(inst) ? i2cRead((addr >>> 0) & 0x7F, n) : null;
  // 逐位元組讀取：先取資料，讀完最後一個位元組時才記錄實際的傳輸
  const pre = (inst, s) => { const d = onBus(inst) ? i2cPrefetch(s.addr & 0x7F, 16) : null; s.nak = !d; s.rxq = d ? [...d] : []; s.got = []; if (!d && onBus(inst)) i2cTraceRead(s.addr, [], true); };
  const take = s => { const x = s.rxq.shift() ?? 0xFF; s.got.push(x); return x; };
  const done = (inst, s) => { if (!s.nak && onBus(inst)) i2cTraceRead(s.addr, s.got, false); s.got = []; };
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
    const rs = b => pre(b, st(b));
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
      [`${P}_I2C_masterReceiveMultiByteNext`]:b => take(st(b)),
      [`${P}_I2C_masterReceiveMultiByteFinish`]:b => { const x = take(st(b)); done(b, st(b)); return x; },
      [`${P}_I2C_masterReceiveSingleByte`]:b => { rs(b); const x = take(st(b)); done(b, st(b)); return x; },
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
        if (cmd === 0x07){ const d = rx(b, s.addr, 1); s.nak = !d; s.cur = d ? d[0] : 0xFF; return; }
        if (cmd === 0x0B) pre(b, s);
        s.cur = take(s);
        if (cmd === 0x05) done(b, s);
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
    CLOCK_GetFreq:() => clk(), CS_getSMCLK:() => clk(),
  });
  Object.assign(api, obj(['I2C0', 'I2C1', 'I2C2', 'I2C3', 'I2C4', 'LPI2C0', 'LPI2C1', 'LPI2C2', 'LPI2C3', 'LPI2C4', 'ADC0', 'ADC1'], n => ({ name:n })));
  /* ---- SPI（各家 SDK 的位元組傳輸函式） ---- */
  const spiQ = o => o.__spi || (o.__spi = []);
  const spiOk = o => !o?.name || !bench.board.spi || o.name === bench.board.spi.inst;
  const xfer1 = (o, b) => { chk(); const r = spiOk(o) ? spiTransfer([b])[0] : 0xFF; if (o && typeof o === 'object') spiQ(o).push(r); return r; };
  const pop = o => { chk(); return o && typeof o === 'object' ? spiQ(o).shift() ?? 0xFF : 0xFF; };
  const blk = (base, x) => { chk(); if (!x || !spiOk(base)) return 1; const n = Number(x.dataSize) || 0, txd = x.txData, r = spiTransfer(Array.from({ length:n }, (_, k) => (txd && txd[k]) ?? 0)); if (x.rxData && typeof x.rxData === 'object') r.forEach((v, k) => { x.rxData[k] = v; }); return 0; };
  Object.assign(api, {
    DL_SPI_transmitDataBlocking8:(o, b) => { xfer1(o, b); }, DL_SPI_transmitData8:(o, b) => { xfer1(o, b); },
    DL_SPI_receiveDataBlocking8:o => pop(o), DL_SPI_receiveData8:o => pop(o), DL_SPI_isBusy:() => false, DL_SPI_isRXFIFOEmpty:o => !spiQ(o).length,
    SPI_0_INST:{ name:'SPI_0' }, SPI_1_INST:{ name:'SPI_1' },
    SSIDataPut:(o, b) => { xfer1(o, b); }, SSIDataGet:(o, buf) => { const r = pop(o); if (buf && typeof buf === 'object') buf[0] = r; }, SSIDataGetNonBlocking:(o, buf) => { const r = pop(o); if (buf && typeof buf === 'object') buf[0] = r; return 1; }, SSIBusy:() => false,
    // C2000：8 位元模式下，寫入的資料要靠左對齊（data << 8），讀回的資料在低 8 位元
    SPI_writeDataBlockingNonFIFO:(o, d) => { xfer1(o, ((Number(d) || 0) >> 8) & 0xFF); }, SPI_readDataBlockingNonFIFO:o => pop(o),
    SPI_writeDataNonBlocking:(o, d) => { xfer1(o, ((Number(d) || 0) >> 8) & 0xFF); }, SPI_readDataNonBlocking:o => pop(o), SPI_isBusy:() => false,
    DSPI_MasterTransferBlocking:blk, LPSPI_MasterTransferBlocking:blk, SPI_MasterTransferBlocking:blk,
  });
  for (const P of ['EUSCI_A', 'EUSCI_B', 'USCI_A', 'USCI_B']) Object.assign(api, {
    [`${P}_SPI_transmitData`]:(o, b) => { xfer1(o, b); }, [`${P}_SPI_receiveData`]:o => pop(o), [`${P}_SPI_isBusy`]:() => 0,
    [`${P}_SPI_getInterruptStatus`]:(o, m) => m, [`${P}_SPI_TRANSMIT_INTERRUPT`]:0x02, [`${P}_SPI_RECEIVE_INTERRUPT`]:0x01,
  });
  Object.assign(api, obj(['EUSCI_A0_BASE', 'EUSCI_A1_BASE', 'EUSCI_A2_BASE', 'EUSCI_A3_BASE', 'USCI_A0_BASE', 'USCI_A1_BASE', 'SSI0_BASE', 'SSI1_BASE', 'SSI2_BASE', 'SSI3_BASE', 'SPIA_BASE', 'SPIB_BASE', 'SPIC_BASE',
    'SPI0', 'SPI1', 'SPI2', 'SPI3', 'SPI8', 'LPSPI0', 'LPSPI1', 'LPSPI2', 'LPSPI3', 'LPSPI4'], n => ({ name:n.replace('_BASE', '') })));

  /* ---- CAN：MSPM0 MCAN、TivaWare、C2000 DCAN、NXP FlexCAN ---- */
  const cbytes = (d, n) => Array.from({ length:Math.min(8, Math.max(0, Number(n) || 0)) }, (_, k) => (d && d[k]) ?? 0);
  const flexData = f => Array.from({ length:8 }, (_, k) => f['dataByte' + k] ?? 0);
  Object.assign(api, {
    DL_MCAN_writeMsgRam:(o, type, idx, el) => { chk(); if (el) CAN.mbox[idx] = { id:(Number(el.id) >>> 18) & 0x7FF, data:cbytes(el.data, el.dlc) }; },
    DL_MCAN_TXBufAddReq:(o, idx) => { chk(); CAN.started = true; const m = CAN.mbox[idx]; if (m) canSend(m.id, m.data); return 0; },
    DL_MCAN_getRxFIFOStatus:(o, fs) => { chk(); CAN.started = true; if (fs && typeof fs === 'object'){ fs.fillLvl = canPending(); fs.getIdx = 0; } },
    DL_MCAN_readMsgRam:(o, type, buf, fifo, el) => { chk(); const fr = canRecv(); if (fr && el){ el.id = fr.id << 18; el.dlc = fr.data.length; el.xtd = 0; el.rtr = 0; el.data = [...fr.data, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 8); } },
    DL_MCAN_writeRxFIFOAck:() => chk(), DL_MCAN_MEM_TYPE_BUF:0, DL_MCAN_MEM_TYPE_FIFO:1, DL_MCAN_RX_FIFO_NUM_0:0, DL_MCAN_RX_FIFO_NUM_1:1, CANFD0:{ name:'CANFD0' }, CANFD1:{ name:'CANFD1' },
    CANInit:() => chk(), CANBitRateSet:() => { chk(); return 500000; }, CANEnable:() => { chk(); CAN.started = true; }, CANDisable:() => { CAN.started = false; },
    CANMessageSet:(base, obj, msg, type) => {
      chk(); if (!msg) return;
      if (type === 0){ if (CAN.started) canSend(msg.ui32MsgID, cbytes(msg.pui8MsgData, msg.ui32MsgLen)); }
      else CAN.objs[obj] = { id:Number(msg.ui32MsgID) & 0x7FF, mask:Number(msg.ui32MsgIDMask) || 0 };
    },
    CANStatusGet:(base, reg) => { chk(); if (reg !== 2) return 0; if (!canPending()) return 0; const o = Object.keys(CAN.objs)[0]; return o ? 1 << (o - 1) : 0; },
    CANMessageGet:(base, obj, msg) => { chk(); const fr = canRecv(); if (fr && msg){ msg.ui32MsgID = fr.id; msg.ui32MsgLen = fr.data.length; if (msg.pui8MsgData && typeof msg.pui8MsgData === 'object') fr.data.forEach((x, k) => { msg.pui8MsgData[k] = x; }); } },
    MSG_OBJ_TYPE_TX:0, MSG_OBJ_TYPE_TX_REMOTE:1, MSG_OBJ_TYPE_RX:2, MSG_OBJ_TYPE_RX_REMOTE:3, CAN_STS_CONTROL:0, CAN_STS_TXREQUEST:1, CAN_STS_NEWDAT:2, CAN_STS_MSGVAL:3,
    MSG_OBJ_NO_FLAGS:0, MSG_OBJ_TX_INT_ENABLE:1, MSG_OBJ_RX_INT_ENABLE:2, MSG_OBJ_USE_ID_FILTER:4, CAN0_BASE:{ name:'CAN0' }, CAN1_BASE:{ name:'CAN1' },
    CAN_initModule:() => chk(), CAN_setBitRate:() => chk(), CAN_startModule:() => { chk(); CAN.started = true; }, CAN_stopModule:() => { CAN.started = false; },
    CAN_setupMessageObject:(base, obj, id, frame, type, mask, flags, len) => { chk(); CAN.objs[obj] = { id:Number(id) & 0x7FF, type, len:Number(len) || 8 }; },
    CAN_sendMessage:(base, obj, len, data) => { chk(); const o = CAN.objs[obj]; if (CAN.started && o) canSend(o.id, cbytes(data, len)); },
    CAN_readMessage:(base, obj, data) => { chk(); const fr = canRecv(); if (!fr) return false; if (data && typeof data === 'object') fr.data.forEach((x, k) => { data[k] = x; }); return true; },
    CAN_MSG_FRAME_STD:0, CAN_MSG_FRAME_EXT:1, CAN_MSG_OBJ_TYPE_TX:0, CAN_MSG_OBJ_TYPE_TX_REMOTE:1, CAN_MSG_OBJ_TYPE_RX:2, CAN_MSG_OBJ_TYPE_RXTX_REMOTE:3, CAN_MSG_OBJ_NO_FLAGS:0,
    CANA_BASE:{ name:'CANA' }, CANB_BASE:{ name:'CANB' },
    FLEXCAN_GetDefaultConfig:cfg => { chk(); if (cfg && typeof cfg === 'object'){ cfg.bitRate = 1000000; cfg.maxMbNum = 16; } },
    FLEXCAN_Init:() => { chk(); CAN.started = true; }, FLEXCAN_Deinit:() => { CAN.started = false; },
    FLEXCAN_SetTxMbConfig:() => chk(), FLEXCAN_SetRxMbConfig:(b, mb, cfg) => { chk(); CAN.objs[mb] = { id:((Number(cfg?.id) || 0) >>> 18) & 0x7FF }; },
    FLEXCAN_ID_STD:id => ((Number(id) || 0) & 0x7FF) << 18,
    FLEXCAN_TransferSendBlocking:(b, mb, f) => { chk(); if (!f) return 1; canSend((Number(f.id) >>> 18) & 0x7FF, flexData(f).slice(0, Math.min(8, Number(f.length) || 0))); return 0; },
    FLEXCAN_WriteTxMb:(b, mb, f) => { chk(); if (f) canSend((Number(f.id) >>> 18) & 0x7FF, flexData(f).slice(0, Math.min(8, Number(f.length) || 0))); return 0; },
    FLEXCAN_GetMbStatusFlags:(b, mask) => { chk(); if (!canPending()) return 0; const mb = Object.keys(CAN.objs)[0]; return mb !== undefined ? ((Number(mask) >>> 0) & (2 ** mb)) : 0; },
    FLEXCAN_ClearMbStatusFlags:() => chk(),
    FLEXCAN_ReadRxMb:(b, mb, f) => { chk(); const fr = canRecv(); if (!fr || !f) return 1; f.id = fr.id << 18; f.length = fr.data.length; f.format = 0; f.type = 0; for (let k = 0; k < 8; k++) f['dataByte' + k] = fr.data[k] ?? 0; return 0; },
    kFLEXCAN_FrameFormatStandard:0, kFLEXCAN_FrameFormatExtend:1, kFLEXCAN_FrameTypeData:0, kFLEXCAN_FrameTypeRemote:1,
    CAN0:{ name:'CAN0' }, CAN1:{ name:'CAN1' }, CAN2:{ name:'CAN2' }, CAN3:{ name:'CAN3' },
  });
  // 範例程式會呼叫的初始化與設定函式（模擬器中不需要動作）
  for (const f of NOOPS) if (!(f in api)) api[f] = () => { chk(); return 0; };
  return api;
}

const NOOPS = ['SYSCFG_DL_init', 'WDT_A_hold', 'PMM_unlockLPM5', 'GPIO_setAsOutputPin', 'GPIO_setAsInputPinWithPullUpResistor', 'GPIO_setAsInputPinWithPullDownResistor', 'GPIO_setAsPeripheralModuleFunctionInputPin',
  'EUSCI_B_I2C_initMaster', 'EUSCI_B_I2C_enable', 'USCI_B_I2C_initMaster', 'USCI_B_I2C_enable', 'SysCtlClockSet', 'SysCtlPeripheralEnable', 'GPIOPinTypeGPIOOutput', 'GPIOPinTypeGPIOInput', 'GPIOPadConfigSet',
  'GPIOPinConfigure', 'GPIOPinTypeI2CSCL', 'GPIOPinTypeI2C', 'GPIOPinTypeADC', 'I2CMasterInitExpClk', 'ADCSequenceConfigure', 'ADCSequenceStepConfigure', 'ADCSequenceEnable', 'ADCIntClear', 'UARTStdioConfig',
  'Device_init', 'Device_initGPIO', 'Interrupt_initModule', 'Interrupt_initVectorTable', 'GPIO_setPadConfig', 'GPIO_setDirectionMode', 'GPIO_setPinConfig', 'GPIO_setQualificationMode', 'I2C_initController', 'I2C_enableModule',
  'ADC_setupSOC', 'ADC_setInterruptSource', 'ADC_enableInterrupt', 'ADC_clearInterruptStatus', 'BOARD_InitBootPins', 'BOARD_InitBootClocks', 'BOARD_InitDebugConsole', 'BOARD_InitPins', 'GPIO_PortInit', 'GPIO_PinInit',
  'ADC16_SetChannelConfig', 'LPADC_DoSoftwareTrigger', 'ADC_DoSoftwareTriggerConvSeqA', 'ADC_SetChannelConfig', 'DL_ADC12_enableConversions', 'CLOCK_EnableClock', 'PORT_SetPinMux', 'IOMUXC_SetPinMux',
  'GPIO_setAsPeripheralModuleFunctionOutputPin', 'EUSCI_A_SPI_initMaster', 'EUSCI_A_SPI_enable', 'EUSCI_B_SPI_initMaster', 'EUSCI_B_SPI_enable', 'USCI_A_SPI_initMaster', 'USCI_A_SPI_enable', 'USCI_B_SPI_initMaster', 'USCI_B_SPI_enable',
  'GPIOPinTypeSSI', 'SSIConfigSetExpClk', 'SSIEnable', 'GPIOPinTypeCAN', 'SPI_disableModule', 'SPI_enableModule', 'SPI_setConfig', 'SPI_disableFIFO', 'SPI_disableLoopback',
  'DSPI_MasterGetDefaultConfig', 'DSPI_MasterInit', 'LPSPI_MasterGetDefaultConfig', 'LPSPI_MasterInit', 'SPI_MasterGetDefaultConfig', 'SPI_MasterInit'];

/** 這些前綴的函式若模擬器沒有實作，編譯時給警告，執行時略過並回傳 0 */
export const VENDOR_PREFIX = /^(DL_|SYSCFG_|SSI|CAN|FLEXCAN_|DSPI_|LPSPI_|MCAN_|GPIO_|WDT_|PMM_|CS_|EUSCI_|USCI_|ADC|SysCtl|GPIOPin|IntMaster|I2C|UART|Device_|Interrupt_|SCI_|CLOCK_|BOARD_|PORT_|IOMUXC_|LPI2C_|LPADC_|SDK_|SysTick|NVIC_|Board_|Timer|PWM|SPI_|FLEXCOMM|POWER_|RESET_|CTIMER_|INPUTMUX_|SYSCON_|LPUART_|USART_|EPWM_|CPUTimer_|XBAR_|DMA_|ECAP_|EQEP_|CMPSS_|DAC_)/;
