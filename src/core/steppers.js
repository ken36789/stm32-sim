// 步進馬達模擬：MCU 計時器（PWM）送出 STEP 脈波 → TB67S128FTG（CLK-IN 模式）→ 雙極步進馬達。
// TB67S128FTG：CLK 每個上升緣前進一個微步；DMODE2..0（模組上的指撥開關）選 1、1/2、1/4 … 1/128 步；
// ENABLE 高電位才輸出；CW/CCW 決定方向；重設後電氣角在 45°（兩組線圈電流相同）。
// 轉子用簡化的動力學模擬：轉矩 = T(速度) × sin(落後角)，落後超過 2 個全步就會「失步」。
import { bench, level, supply, hasGnd, powered, netInfo, headerPin, pinPreListeners } from './sim.js';
import { variantOf } from './parts.js';

export const USTEP = [1, 2, 4, 8, 16, 32, 64, 128];                         // DMODE2..0 = 000 … 111
export const dmodeBits = div => USTEP.indexOf(div).toString(2).padStart(3, '0');
export const ustepName = div => div === 1 ? '全步' : div === 2 ? '半步（1/2）' : `1/${div}`;
export const LOADS = [
  { id:0, name:'無負載', J:0, Tf:.012 },
  { id:1, name:'鋁圓盤（Ø60 mm、50 g）', J:2.2e-5, Tf:.03 },
  { id:2, name:'大飛輪（Ø100 mm、400 g）', J:5e-4, Tf:.05 },
];

/* ---------- MCU 計時器的 PWM 輸出（兩組 STEP） ---------- */
export const PWM = [{ f:0, on:false }, { f:0, on:false }];
export function pwmReset(){ stepperTick(); PWM.forEach(p => { p.f = 0; p.on = false; }); }
/** 由 SDK 的計時器名稱與通道找出是哪一組 STEP 輸出（-1：不是 STEP 腳） */
export function stepIndex(inst, ch){
  const s = bench.board.step; if (!s || !inst) return -1;
  return s.findIndex(x => x.inst === inst && (ch === undefined || x.ch === undefined || x.ch === ch));
}
export const stepIndexes = inst => (bench.board.step || []).map((x, k) => x.inst === inst ? k : -1).filter(k => k >= 0);
export function pwmSet(k, f){ if (k < 0 || k > 1) return; stepperTick(); PWM[k].f = Math.max(0, Number(f) || 0); }
export function pwmRun(k, on){ if (k < 0 || k > 1) return; stepperTick(); PWM[k].on = !!on; }
export const stepPin = k => headerPin(bench.board.step[k].pin)?.mcu;

/* ---------- 每個馬達模組的狀態 ---------- */
export const isStepper = m => m.type === 'stepper';
export function motorOf(m){
  return m.st.mot || (m.st.mot = { div:16, load:1, ucnt:0, acc:0, theta:0, omega:0, lastT:null, hist:[], samp:[], stallT:-1e9, stalls:0, manual:null, seg:null });
}
export function motorParams(m){
  const v = variantOf(m.type, m.variant), mo = motorOf(m), L = LOADS[mo.load] || LOADS[0];
  return { v, L, J:v.J + L.J, Tf:L.Tf, stepRad:v.step * Math.PI / 180, fullSteps:Math.round(360 / v.step) };
}
/** 驅動模組的輸入：供電、ENABLE、方向、STEP 頻率（MCU 計時器或手動測試） */
export function driverInputs(m){
  const P = n => `${m.id}.${n}`, mo = motorOf(m), vcc = supply(P('VCC'));
  const ok = powered() && vcc >= 2 && vcc <= 5.5 && hasGnd(P('GND'));
  if (mo.manual) return { ok, en:ok, dir:mo.manual.dir, f:ok ? mo.manual.pps : 0, src:'manual', k:-1 };
  let f = 0, k = -1; const clk = netInfo(P('CLK')).gpio, s = bench.board.step;
  if (s) s.forEach((x, i) => { if (clk.includes(stepPin(i))){ k = i; if (PWM[i].on && PWM[i].f > 0) f = PWM[i].f; } });
  return { ok, en:ok && level(P('EN')) === 1, dir:level(P('CW')) === 1 ? 1 : -1, f: ok ? f : 0, src:'mcu', k };
}

/* ---------- 手動測試：控制台的脈波產生器（梯形加減速） ---------- */
export function startManual(m, o){
  stepperTick();
  const mo = motorOf(m);
  mo.manual = { pps:0, target:o.pps, accel:o.accel, steps:o.steps, pos:0, dir:o.dir || 1, ramp:o.ramp, done:false, t0:performance.now() };
}
export function stopManual(m){ stepperTick(); motorOf(m).manual = null; }
function manualStep(man, dt){
  if (man.done) return;
  const remain = man.steps - man.pos, brake = man.ramp ? man.pps * man.pps / (2 * man.accel) : 0;
  if (man.ramp){
    if (remain <= brake) man.pps = Math.max(0, man.pps - man.accel * dt);
    else man.pps = Math.min(man.target, man.pps + man.accel * dt);
  } else man.pps = remain > 0 ? man.target : 0;
  man.pos += man.pps * dt;
  if (man.pos >= man.steps || (man.ramp && man.pps <= 0 && man.pos > 0)){ man.pps = 0; man.done = true; }
}

/* ---------- 物理：每 0.2 ms 積分一次 ---------- */
const SUB = .2;
function torqueMax(m, mp, omegaFs){ return mp.v.T * mp.v.Iset / mp.v.rated / (1 + Math.abs(omegaFs) / mp.v.fc); }
function advance(m, t1){
  const mo = motorOf(m), mp = motorParams(m);
  if (mo.lastT === null){ mo.lastT = t1; return; }
  let t = mo.lastT; if (t1 - t > 200) t = t1 - 200;          // 分頁在背景太久：只補最近 0.2 秒
  const inp = driverInputs(m), div = mo.div;
  // 輸入改變時開一個新的波形區段（給示波器畫 STEP 與線圈電流）
  const key = `${inp.f}|${inp.dir}|${inp.en}|${div}`;
  if (!mo.seg || mo.seg.key !== key){ mo.seg = { key, t, f:inp.en ? inp.f : 0, dir:inp.dir, en:inp.en, div, ucnt:mo.ucnt, acc:mo.acc }; mo.hist.push(mo.seg); if (mo.hist.length > 4000) mo.hist.splice(0, 1000); }
  const k = mp.v.T * (Math.PI / 2) / mp.stepRad, zeta = .5, c = 2 * zeta * Math.sqrt(k * mp.J);
  while (t < t1){
    const dt = Math.min(SUB, t1 - t) / 1000;
    // 手動測試的脈波產生器每 5 ms 更新一次頻率（和韌體每 10 ms 更新一樣是一階一階的）
    if (mo.manual && t - (mo.manual.tu ?? -1e9) >= 5){
      const man = mo.manual; manualStep(man, man.tu === undefined ? 0 : (t - man.tu) / 1000); man.tu = t;
      if (inp.en && mo.seg.f !== man.pps){ mo.seg = { key:`${man.pps}|${inp.dir}|${inp.en}|${div}`, t, f:man.pps, dir:inp.dir, en:inp.en, div, ucnt:mo.ucnt, acc:mo.acc }; mo.hist.push(mo.seg); if (mo.hist.length > 4000) mo.hist.splice(0, 1000); }
    }
    const f = inp.en ? (mo.manual ? mo.manual.pps : inp.f) : 0;
    mo.acc += f * dt; const n = Math.floor(mo.acc); mo.acc -= n; mo.ucnt += n * inp.dir;
    const cmd = mo.ucnt / div;                                // 磁場（指令）位置，單位：全步
    let T = 0;
    if (inp.en){
      const lag = cmd - mo.theta, fieldW = f / div * inp.dir, e = lag - Math.round(lag / 4) * 4;
      // 電氣阻尼只在轉子跟得上磁場時有效；一旦失步（落後接近 2 個全步），就沒有東西把轉子拉回同步
      // 失步後（mo.slip）電氣阻尼不再把轉子往磁場速度拉：轉子會慢下來、在原地抖動，直到磁場慢到又能把它拉回同步
      if (Math.abs(e) > 1.9) mo.slip = true;
      else if (mo.slip && Math.abs(e) < .5 && Math.abs(mo.omega - fieldW) < 40) mo.slip = false;
      const Tm = torqueMax(m, mp, mo.omega);
      T = Tm * Math.sin(lag * Math.PI / 2) - (mo.slip ? 0 : c * Math.max(0, 1 - Math.abs(e) / 2)) * (mo.omega - fieldW) * mp.stepRad;
      T = Math.max(-Tm, Math.min(Tm, T));                     // 馬達能出的轉矩有上限（含阻尼）
      if (Math.abs(e) > 1.9 && performance.now() - mo.stallT > 300){ mo.stallT = performance.now(); mo.stalls++; }
    }
    // 摩擦：靜止時小於摩擦力就不動
    const fr = mp.Tf;
    if (Math.abs(mo.omega) < .5 && Math.abs(T) <= fr){ mo.omega = 0; }
    else { T -= fr * Math.sign(mo.omega || T); mo.omega += T / mp.J / mp.stepRad * dt; }
    mo.theta += mo.omega * dt;
    mo.wf = (mo.wf || 0) + (mo.omega - (mo.wf || 0)) * Math.min(1, dt / .015);   // 平滑過的轉速（給曲線圖）
    t += dt * 1000;
    if (!mo.samp.length || t - mo.samp[mo.samp.length - 1].t >= 4){
      mo.samp.push({ t, cmdW:f / div * inp.dir, w:mo.wf, cmd, theta:mo.theta, pps:f, dir:inp.dir, en:inp.en });
      if (mo.samp.length > 4000) mo.samp.splice(0, 1000);
    }
  }
  mo.lastT = t1;
}
export function stepperTick(now = performance.now()){ for (const m of bench.modules) if (isStepper(m)) advance(m, now); }
// DIR、EN 改變之前，先把運動積分到這一刻
pinPreListeners.push(() => { if (bench.modules.some(isStepper)) stepperTick(); });

/* ---------- 給介面與示波器用 ---------- */
/** 某一時刻的微步計數（由波形區段推算） */
export function segAt(mo, t){
  const H = mo.hist; let lo = 0, hi = H.length - 1, k = -1;
  while (lo <= hi){ const mid = (lo + hi) >> 1; if (H[mid].t <= t){ k = mid; lo = mid + 1; } else hi = mid - 1; }
  return k;
}
export function ucntAt(mo, t){
  const k = segAt(mo, t), s = k >= 0 ? mo.hist[k] : null;
  if (!s) return { ucnt:0, seg:null };
  return { ucnt:s.ucnt + s.dir * Math.floor(s.acc + s.f * (t - s.t) / 1000), seg:s };
}
/** 線圈電流（相對於設定電流 −1…1）：微步依正弦／餘弦表，全步時兩組都是 ±100% */
export function coilCurrents(ucnt, div, en){
  if (!en) return [0, 0];
  const e = Math.PI / 4 + ucnt * (Math.PI / 2) / div;
  if (div === 1) return [Math.sign(Math.cos(e)) || 1, Math.sign(Math.sin(e)) || 1];
  return [Math.cos(e), Math.sin(e)];
}
export function motorInfo(m){
  const mo = motorOf(m), mp = motorParams(m), inp = driverInputs(m), now = performance.now();
  const lost = Math.round((mo.ucnt / mo.div - mo.theta) / 4) * 4;
  return { div:mo.div, pps:inp.en ? inp.f : 0, dir:inp.dir, en:inp.en, ok:inp.ok, src:inp.src, k:inp.k,
    rps:(mo.wf || 0) / mp.fullSteps, rpm:(mo.wf || 0) / mp.fullSteps * 60, cmdRpm:(inp.en ? inp.f : 0) / mo.div / mp.fullSteps * 60 * inp.dir,
    deg:(((mo.theta / mp.fullSteps) * 360) % 360 + 360) % 360, revs:mo.theta / mp.fullSteps, lost, stalled: now - mo.stallT < 1500, stalls:mo.stalls,
    stepDeg:mp.v.step / mo.div, fullSteps:mp.fullSteps, perRev:mp.fullSteps * mo.div, maxJumpRps:jumpLimit(m), mp };
}
/** 不加速、直接跳到某速度時大概不會失步的上限（圈／秒）：v² ≤ 2 × a_max × 1.5 全步 */
export function jumpLimit(m){ const mp = motorParams(m), a = Math.max(0, torqueMax(m, mp, 0) - mp.Tf) / mp.J; return Math.sqrt(2 * a * 1.5 * mp.stepRad) / (2 * Math.PI); }
/** 在某個速度（圈／秒）下還能有的最大加速度（圈／秒²） */
export function accelLimit(m, rps){ const mp = motorParams(m), w = rps * mp.fullSteps, a = (torqueMax(m, mp, w) - mp.Tf) / mp.J; return Math.max(0, a) / (2 * Math.PI); }
/** 改 DMODE：電氣角（磁場位置）保持不變，之後每個脈波走的角度改變 */
export function setDiv(m, div){
  stepperTick(); const mo = motorOf(m), d = USTEP.includes(div) ? div : 16;
  if (d !== mo.div){ mo.ucnt = Math.round(mo.ucnt * d / mo.div); mo.div = d; }
}
export function setLoad(m, id){ stepperTick(); motorOf(m).load = LOADS[id] ? id : 1; }
