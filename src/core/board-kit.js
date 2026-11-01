// 建立開發板資料的共用工具（TI、NXP 使用；ST 在 boards.js 另有 Arduino 腳位處理）
export const LED_HEX = { green:0x2fe36b, yellow:0xffc21a, red:0xff3b30, blue:0x3d7bff, orange:0xff8a1f, white:0xf4f7ff };
export const PWR = ['3V3', '5V', 'GND', 'GND'];

/**
 * o.header：排針標籤（電源或腳位名稱）；o.pins：標籤 → MCU 腳位（Arduino 標籤時使用）
 * o.adc：具 ADC 功能的 MCU 腳位；o.i2c：{ bus, inst, scl, sda, drv? }（scl/sda 為排針標籤）
 */
export function makeBoard(o){
  const map = o.pins || {}, counts = {};
  const header = o.header.map(label => {
    const total = o.header.filter(x => x === label).length, n = counts[label] = (counts[label] || 0) + 1;
    const kind = label === 'GND' ? 'gnd' : (label === '3V3' || label === '5V') ? 'pwr' : 'gpio';
    const mcu = kind === 'gpio' ? (map[label] || label) : null, tags = [];
    if (kind === 'gpio'){
      if (o.adc.includes(mcu)) tags.push('adc');
      if (label === o.i2c.scl) tags.push('scl');
      if (label === o.i2c.sda) tags.push('sda');
      if (mcu === o.vcp[1] || mcu === o.vcp[2]) tags.push('vcp');
      if (o.leds.some(l => l[1] === mcu)) tags.push('led');
      if (o.btn && o.btn[1] === mcu) tags.push('btn');
    }
    return { id:'J.' + (total > 1 ? `${label}~${n}` : label), label, kind, mcu, tags };
  });
  if (header.length % 2) throw new Error(`${o.id} 排針數量必須是偶數`);
  return {
    vendor:o.vendor, id:o.id, name:o.name, series:o.series, mcu:o.mcu, core:o.core, mhz:o.mhz, flash:o.flash, ram:o.ram,
    form:o.form, prog:o.prog, devId:o.devId || null, pkg:o.pkg, sdk:o.sdk, pinStyle:o.pinStyle, kind:o.kind || 'eval',
    leds:o.leds.map(([name, pin, color, activeLow]) => ({ name, pin, color, hex:LED_HEX[color], activeLow:!!activeLow })),
    btn:o.btn ? { name:o.btn[0], pin:o.btn[1], activeLow:!!o.btn[2] } : null,
    vcp:{ periph:o.vcp[0], tx:o.vcp[1], rx:o.vcp[2], handle:o.vcp[3] || null },
    i2c:o.i2c, adcBits:o.adcBits || 12, adcDrv:o.adcDrv, adcInst:o.adcInst, adcCh:o.adcCh ?? 0,
    header, pcb:o.pcb, xtal:o.xtal || null, dbg:o.dbg || null, ldo:o.ldo || null, note:o.note || null, links:o.links,
  };
}
