// 頂部狀態燈號與按鈕可用狀態
import { $ } from './dom.js';
import { flashState } from './state.js';
import { SIM, shorts, powered } from '../core/sim.js';
import { isRunning } from '../core/runtime.js';

export function setRun(s){ SIM.run = s; updatePills(); updateButtons(); }
export function updatePills(){
  const set = (id, cls, text) => { const el = $(id); el.className = 'pill ' + cls; el.lastElementChild.textContent = text; };
  set('#pPower', !SIM.usb ? '' : shorts().length ? 'err' : 'ok', !SIM.usb ? 'USB 未接' : shorts().length ? '短路保護' : 'USB 供電');
  set('#pFlash', SIM.flashed ? 'ok' : '', SIM.flashed ? `Flash ${(SIM.flashed.size / 1024).toFixed(1)} KB` : 'Flash 空白');
  const RS = { idle:['', '待機'], flash:['busy', '燒錄中'], run:['ok', '執行中'], halt:['warn', '已停止'], fault:['err', 'HardFault'], done:['', 'main 已返回'], off:['', '斷電'], reset:['warn', '重設中'] }[SIM.run] || ['', SIM.run];
  set('#pRun', RS[0], RS[1]);
}
export function updateButtons(){
  $('#btnFlash').disabled = flashState.busy; $('#btnBuild').disabled = flashState.busy;
  $('#btnReset').disabled = flashState.busy || !SIM.flashed || !powered();
  $('#btnStop').disabled = !isRunning();
}
