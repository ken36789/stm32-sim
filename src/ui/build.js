// 編譯（gcc 風格輸出）與 ST-LINK 燒錄流程
import { $, toast } from './dom.js';
import { flashState } from './state.js';
import { codeValue, log, logClear, markGutter } from './editor.js';
import { setRun, updatePills, updateButtons } from './status.js';
import { compile } from '../core/compiler.js';
import { SIM, powered, bench } from '../core/sim.js';
import { fmtKB, flashBase, hexAddr } from '../core/boards.js';
import { startProgram, stopProgram } from '../core/runtime.js';

/* ================= 建置與燒錄 ================= */
export let lastBuild = null;
/** 各家晶片的編譯器（顯示用） */
function toolchain(b){
  if (b.series === 'MSP430') return { cc:'msp430-elf-gcc', flags:`-mmcu=${b.mcu.toLowerCase()} -O2`, ld:`-T ${b.mcu.toLowerCase()}.ld` };
  if (b.series === 'C2000') return { cc:'cl2000', flags:'-v28 -ml -mt --float_support=fpu32 -O2', ld:`-l ${b.mcu.replace('TMS320', '').toLowerCase()}_flash_lnk.cmd` };
  const fpu = /M7/.test(b.core) ? '-mfpu=fpv5-d16 -mfloat-abi=hard' : /M4F|M4|M33/.test(b.core) ? '-mfpu=fpv4-sp-d16 -mfloat-abi=hard' : '-mfloat-abi=soft';
  const cpu = (b.core.match(/M(\d+\+?)/) || ['', '4'])[1].replace('+', 'plus');
  return { cc:'arm-none-eabi-gcc', flags:`-mcpu=cortex-m${cpu} -mthumb ${fpu} -O2`, ld: b.vendor === 'ST' ? `-T ${b.mcu.slice(0, 11)}X_FLASH.ld --specs=nano.specs` : `-T ${b.mcu.toLowerCase()}_flash.ld --specs=nano.specs` };
}
export function build(){
  const src = codeValue(), res = compile(src), lines = src.split('\n'), b = bench.board, tc = toolchain(b);
  logClear();
  log(`${tc.cc} ${tc.flags} -c main.c`, 'ld');
  const errLines = new Set(); let ne = 0, nw = 0;
  for (const d of res.diag){
    const isE = d.sev === 'error'; isE ? ne++ : nw++;
    if (d.link){ log(`build/firmware.elf: ${d.msg}`, 'le'); continue; }
    if (d.line){
      errLines.add(d.line);
      log(`main.c:${d.line}:${d.col}: ${isE ? 'error' : 'warning'}: ${d.msg}`, isE ? 'le' : 'lw');
      const src1 = (lines[d.line - 1] || '').replace(/\t/g, '  ');
      log(`${String(d.line).padStart(5)} | ${src1}\n      | ${' '.repeat(Math.max(0, d.col - 1))}^`, 'ld');
    } else log(`main.c: ${isE ? 'error' : 'warning'}: ${d.msg}`, isE ? 'le' : 'lw');
  }
  markGutter(errLines);
  if (!res.ok){ log(`建置失敗：${ne} 個錯誤，${nw} 個警告`, 'le'); lastBuild = null; return res; }
  log(`${tc.cc} -o build/firmware.elf ${tc.ld}`, 'ld');
  const z = res.size, dec = z.text + z.data + z.bss;
  log(`   text\t   data\t    bss\t    dec\t    hex\tfilename\n${String(z.text).padStart(7)}\t${String(z.data).padStart(7)}\t${String(z.bss).padStart(7)}\t${String(dec).padStart(7)}\t${dec.toString(16).padStart(7)}\tbuild/firmware.elf`, 'ld');
  log(`建置完成：0 個錯誤，${nw} 個警告。程式大小 ${((z.text + z.data) / 1024).toFixed(1)} KB／Flash ${fmtKB(b.flash)}`, 'lo');
  lastBuild = { src, res };
  return res;
}
export async function flash(){
  if (flashState.busy) return;
  const res = build(); if (!res.ok){ toast('編譯失敗，請看建置輸出。', 'err'); return; }
  log('');
  if (!SIM.usb){ log(`Error: 找不到 ${bench.board.prog}，請先接上 USB 線。`, 'le'); toast(`沒有偵測到 ${bench.board.prog}，請接上 USB。`, 'err'); return; }
  if (!powered()){ log('Error: Target voltage 0.00 V，電路短路導致保護斷電。', 'le'); toast('開發板沒有電，先排除短路。', 'err'); return; }
  flashState.busy = true; stopProgram(true); setRun('flash'); updateButtons();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const lost = () => !SIM.usb || !powered();
  try {
    const b = bench.board, v3 = /V3/.test(b.prog), base = flashBase(b);
    const iface = b.series === 'MSP430' ? 'Spy-Bi-Wire' : b.series === 'C2000' ? 'JTAG' : 'SWD';
    log(`燒錄器      : ${b.prog}${b.vendor === 'ST' ? `\nST-LINK FW  : ${v3 ? 'V3J15M6' : 'V2J45M31'}` : ''}\n介面        : ${iface}\nTarget 電壓 : 3.29 V`, 'ld'); await wait(380);
    log(`${b.devId ? `Device ID   : ${b.devId}\n` : ''}Device name : ${b.mcu}\nFlash size  : ${fmtKB(b.flash)}\nDevice CPU  : ${b.core}`, 'ld'); await wait(320);
    if (lost()) throw new Error('lost');
    log('開啟 build/firmware.elf ……'); await wait(180);
    log(`抹除 ${b.mcu} 的 Flash 起始區塊……`); await wait(520);
    SIM.flashed = null; updatePills();
    const total = res.size.text + res.size.data, prog = $('#prog'), bar = $('#progBar'); prog.hidden = false;
    for (let p = 0; p <= 100; p += 4){
      bar.style.width = p + '%'; await wait(45);
      if (lost()) throw new Error('lost');
    }
    log(`寫入 ${(total / 1024).toFixed(2)} KB 至 ${hexAddr(base)} 完成，耗時 00:00:01.${String(180 + Math.round(total / 140)).padStart(3, '0')}`, 'lo'); await wait(220);
    log('驗證中…… 驗證成功', 'lo'); await wait(200);
    log('MCU 重設，開始執行', 'lo');
    SIM.flashed = { js:res.js, size:total };
    prog.hidden = true; bar.style.width = '0';
    flashState.busy = false; updatePills(); updateButtons();
    startProgram(); toast('燒錄完成，程式開始執行。');
  } catch (e){
    $('#prog').hidden = true; $('#progBar').style.width = '0';
    flashState.busy = false; SIM.flashed = null;
    log(`Error: 燒錄中斷，${bench.board.prog} 連線遺失。Flash 內容不完整，請重新燒錄。`, 'le');
    setRun(powered() ? 'idle' : 'off'); updatePills(); updateButtons();
    toast('燒錄中斷，Flash 內容不完整。', 'err');
  }
}
