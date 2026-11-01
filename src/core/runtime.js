// 執行燒錄到 Flash 的程式（每次重設都重新開始）
import { SIM, powered, bench } from './sim.js';
import { flashBase, hexAddr } from './boards.js';
import { makeAPI, API_NAMES, STOP } from './hal.js';
import { AsyncFunction } from './compiler.js';
import { hooks } from './hooks.js';
import { resetBuses } from './buses.js';

export let RUN = null, runSeq = 0;
export function startProgram(){
  stopProgram(true);
  if (!SIM.flashed || !powered()) return;
  const r = { stop:false, t0:performance.now(), id:++runSeq }; RUN = r;
  SIM.out = {}; SIM.mode = {}; resetBuses(); hooks.outputs();
  hooks.run('run'); hooks.sys(`MCU 重設，從 ${hexAddr(flashBase(bench.board))} 開始執行`);
  let fn; try { fn = new AsyncFunction(...API_NAMES, SIM.flashed.js); } catch (e){ hooks.run('fault'); hooks.sys('無法啟動：' + e.message, 'er'); return; }
  const api = makeAPI(r);
  fn(...API_NAMES.map(k => api[k])).then(() => {
    if (RUN === r){ RUN = null; hooks.run('done'); hooks.sys('main() 已返回，MCU 進入閒置'); }
  }).catch(e => {
    if (e === STOP || r.stop || RUN !== r) return;
    RUN = null; hooks.run('fault');
    const msg = e instanceof ReferenceError ? '使用了未宣告的變數：' + (String(e.message).split(' ')[0]) : (e && e.message) || String(e);
    hooks.sys('HardFault：' + msg, 'er');
  });
}
export function stopProgram(silent){ if (RUN){ RUN.stop = true; RUN = null; } if (!silent) hooks.run('halt'); }


export function isRunning(){ return !!RUN; }
export function runElapsed(){ return RUN ? performance.now() - RUN.t0 : 0; }
