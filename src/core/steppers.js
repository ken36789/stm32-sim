// 步進馬達模擬：MCU 送出 STEP 脈波 → TB67S128FTG（CLK-IN 模式）→ 雙極步進馬達。
// 兩種接法：
//   1. 一體式套件（type 'stepper'）：驅動板和馬達做成一個模組，只要接 VCC／GND／CLK／CW／EN。
//   2. 分開接線（'tb67' 驅動板＋'motor' 馬達＋'psu' 馬達電源）：每一支腳都依實際接線模擬——
//      VIN 要有 6.5–44 V、GND 要和 MCU 共地、STANDBY／ENABLE 要高電位、RESET 要低電位、
//      MODE0–2 決定微步、A+／A−／B+／B− 的線序決定方向，接錯會觸發過電流（ISD）、斷線（OPD）、過熱（TSD），
//      錯誤會鎖住，直到 STANDBY 拉低再拉高，或馬達電源重新上電（和 datasheet 一樣）。
// 轉子用簡化的動力學：轉矩 = 最大轉矩 × 電流比例 × sin(落後角)，落後超過 2 個全步就會「失步」。
import { bench, level, supply, netInfo, net, headerPin, pinPreListeners, pinListeners, driveHooks, drvVin, powered, hasGnd, moduleById } from './sim.js';
import { variantOf } from './parts.js';

export const USTEP = [1, 2, 4, 8, 16, 32, 64, 128];                         // MODE2..0（DMODE2..0）= 000 … 111
export const dmodeBits = div => USTEP.indexOf(div).toString(2).padStart(3, '0');
export const ustepName = div => div === 1 ? '全步' : div === 2 ? '半步（1/2）' : `1/${div}`;
export const LOADS = [
  { id:0, name:'無負載', J:0, Tf:.012 },
  { id:1, name:'鋁圓盤（Ø60 mm、50 g）', J:2.2e-5, Tf:.03 },
  { id:2, name:'大飛輪（Ø100 mm、400 g）', J:5e-4, Tf:.05 },
];
export const FAULTS = {
  ISD:{ name:'過電流（ISD）', lo:'LO0＝低、LO1＝高', why:'輸出端短路：馬達線接到地、電源或互相碰在一起，或一組線圈跨接在 A 和 B 之間。驅動 IC 立刻關閉輸出保護自己。' },
  OPD:{ name:'馬達斷線（OPD）', lo:'LO0＝高、LO1＝低', why:'ENABLE 打開了，但線圈沒有電流回路：馬達沒接，或某一條馬達線沒接好。' },
  TSD:{ name:'過熱（TSD）', lo:'LO0＝低、LO1＝低', why:'晶片溫度超過約 160 °C。電流限制（VREF）設太高，或沒有散熱片。' },
};
export const VREF_GAIN = 1.56;                                              // RS-less（ACDS）模式：I ＝ 1.56 × VREF
const OUTS = ['A+', 'A-', 'B+', 'B-'];

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

/* ---------- 模組種類 ---------- */
export const isStepper = m => m.type === 'stepper' || m.type === 'motor';  // 有轉子的模組（示波器的對象）
export const isDriver = m => m.type === 'tb67';
export const isMotorPart = m => isStepper(m) || isDriver(m) || m.type === 'psu';
export function motorOf(m){
  return m.st.mot || (m.st.mot = { div:16, jdiv:16, load:1, ucnt:0, acc:0, theta:0, omega:0, lastT:null, hist:[], samp:[], stallT:-1e9, stalls:0, manual:null, seg:null, off:0, mapKey:'', bb:{ t:-1e9, f:0 } });
}
/** 驅動板的狀態：MODE 跳線、VREF、鎖住的錯誤、晶片溫度 */
export function drvOf(d){ return d.st.drv || (d.st.drv = { jdiv:16, vref:.96, fault:null, temp:25, lastT:null, wasOn:false }); }

/* ---------- 接線：馬達線圈接到哪一塊驅動板、怎麼對應 ---------- */
const pinMod = x => moduleById(x.split('.')[0]);
const pinName = x => x.slice(x.indexOf('.') + 1);
/** 回傳 { drv, A, B, ok, bad, sigma }：A／B 是馬達的兩組線圈各接到驅動板的哪一相、極性 */
export function coilMap(motor){
  if (motor.type !== 'motor') return { drv:null };
  const outsOf = n => net(`${motor.id}.${n}`).filter(x => { const d = pinMod(x); return d && isDriver(d) && OUTS.includes(pinName(x)); });
  const term = Object.fromEntries(OUTS.map(n => [n, outsOf(n)]));
  const first = OUTS.map(n => term[n][0]).find(Boolean);
  if (!first) return { drv:null };
  const drv = pinMod(first), mine = n => term[n].filter(x => x.startsWith(drv.id + '.')).map(pinName);
  const coil = (p, q) => {
    const a = mine(p), b = mine(q);
    if (a.length > 1 || b.length > 1) return { bad:'short', a:a.join('＋'), b:b.join('＋') };
    if (!a.length || !b.length) return { bad:'open', a:a[0] || null, b:b[0] || null };
    if (a[0][0] !== b[0][0]) return { bad:'mix', a:a[0], b:b[0] };
    if (a[0] === b[0]) return { bad:'short', a:a[0], b:b[0] };
    return { ph:a[0][0], s:a[0][1] === '+' ? 1 : -1, a:a[0], b:b[0] };
  };
  const A = coil('A+', 'A-'), B = coil('B+', 'B-');
  let bad = A.bad || B.bad || null;
  if (!bad && A.ph === B.ph) bad = 'mix';
  const ok = !bad;
  // 相對方向：正常＝+1；一組線圈反接、或 A／B 兩組對調＝−1（馬達反轉）
  const sigma = ok ? (A.ph === 'A' ? 1 : -1) * A.s * B.s : 1;
  const others = new Set(OUTS.flatMap(n => term[n]).map(x => x.split('.')[0]));
  return { drv, A, B, ok, bad, sigma, multi:others.size > 1, normal: ok && A.ph === 'A' && A.s === 1 && B.s === 1 };
}
/** 接在這塊驅動板上的馬達（第一顆） */
export function motorOfDriver(d){ return bench.modules.find(m => m.type === 'motor' && coilMap(m).drv === d) || null; }

/* ---------- 驅動板的輸入與狀態 ---------- */
/** 驅動板某支輸出腳是否碰到地、電源、MCU 腳或自己的其他腳（短路） */
function outShorted(d){
  return OUTS.some(n => net(`${d.id}.${n}`).some(x => x !== `${d.id}.${n}` && (['GND', '3V3', '5V', 'RAIL+', 'RAIL-'].includes(x) || /\.V[+-]$/.test(x) || (!/^M\d+\./.test(x)) || (x.startsWith(d.id + '.')))));
}
export function drvStatus(d, manual){
  const ds = drvOf(d), P = n => `${d.id}.${n}`, vm = drvVin(d), gndMcu = netInfo(P('GND')).gnd;
  const wired = n => net(P(n)).length > 1;
  // 邏輯輸入：板上下拉，所以「沒接」或「沒有共地」都等於低電位
  const hi = n => { const i = netInfo(P(n)); if (i.src) return i.src <= 5.5; return gndMcu && level(P(n)) === 1; };
  const modeWired = ['MODE0', 'MODE1', 'MODE2'].some(wired);
  const div = modeWired ? USTEP[(hi('MODE2') ? 4 : 0) + (hi('MODE1') ? 2 : 0) + (hi('MODE0') ? 1 : 0)] : ds.jdiv;
  const stby = manual ? true : hi('STBY'), en = manual ? true : hi('EN'), rst = manual ? false : hi('RST'), dir = manual ? manual.dir : hi('DIR') ? 1 : -1;
  const vmOk = vm >= 6.5 && vm <= 44, dead = !!d.st.damaged;
  return { vm, vmOk, gndMcu, stby, en, rst, dir, div, modeWired, ilim:ds.vref * VREF_GAIN, vref:ds.vref, fault:ds.fault, temp:ds.temp, damaged:dead,
    ioref:supply(P('IOREF')), outShort:outShorted(d),
    logic: vmOk && stby && !dead,                                            // 內部邏輯在動
    out: vmOk && stby && en && !dead && !ds.fault };                         // 線圈有電流
}
// LO0／LO1：開汲極輸出，上拉到 IOREF。IOREF 沒電時浮接
driveHooks.push((m, n) => {
  if (m.type !== 'tb67' || (n !== 'LO0' && n !== 'LO1')) return null;
  if (!supply(`${m.id}.IOREF`)) return null;
  const f = drvOf(m).fault, low = n === 'LO0' ? f === 'ISD' || f === 'TSD' : f === 'OPD' || f === 'TSD';
  return low ? 0 : 1;
});
/** 每一格畫面：錯誤偵測與解除、晶片溫度、上電／離開待機時電氣角回到 45° */
function driverTick(d, now){
  const ds = drvOf(d), dt = ds.lastT === null ? 0 : Math.min(.25, (now - ds.lastT) / 1000); ds.lastT = now;
  const mot = motorOfDriver(d), man = mot ? motorOf(mot).manual : null, st = drvStatus(d, man), v = variantOf(d.type, d.variant);
  if (ds.fault && (!st.vmOk || !st.stby)) ds.fault = null;                  // 錯誤解除：VM 斷電，或 STANDBY 拉低
  const live = st.vmOk && st.stby && st.en && !st.damaged;
  if (live && !ds.fault){
    const cm = mot ? coilMap(mot) : null;
    if (st.outShort || (cm && (cm.bad === 'mix' || cm.bad === 'short'))) ds.fault = 'ISD';
    else if (!mot || (cm && cm.bad === 'open')) ds.fault = 'OPD';
  }
  const I = live && !ds.fault ? st.ilim : 0, Tss = 25 + v.heat * I * I;   // 溫度：和電流平方成正比，時間常數約 15 秒
  ds.temp += (Tss - ds.temp) * Math.min(1, dt / 15);
  if (ds.temp >= 160 && live && !ds.fault) ds.fault = 'TSD';
  if (mot && st.logic && (!ds.wasOn || st.rst)) snapAngle(motorOf(mot));   // RESET 高電位時一直停在初始電氣角
  ds.wasOn = st.logic;
}
/** 電氣角回到初始的 45°（微步計數歸零到最接近的電氣週期） */
function snapAngle(mo){ const per = 4 * mo.div; mo.ucnt = Math.round(mo.ucnt / per) * per; mo.acc = 0; }

/* ---------- 每顆馬達實際收到的輸入 ---------- */
export function motorParams(m){
  const v = variantOf(m.type, m.variant), mo = motorOf(m), L = LOADS[mo.load] || LOADS[0];
  return { v, L, J:v.J + L.J, Tf:L.Tf, stepRad:v.step * Math.PI / 180, fullSteps:Math.round(360 / v.step) };
}
function clkFreq(clkNode){
  let f = 0, k = -1; const clk = netInfo(clkNode).gpio, s = bench.board.step;
  if (s) s.forEach((x, i) => { if (clk.includes(stepPin(i))){ k = i; if (PWM[i].on && PWM[i].f > 0) f = PWM[i].f; } });
  return { f, k };
}
/** 驅動板的輸入：供電、ENABLE、方向、STEP 頻率（MCU 計時器或手動測試）、微步、電流 */
export function driverInputs(m){
  const mo = motorOf(m);
  if (m.type === 'stepper'){                                                 // 一體式套件
    const P = n => `${m.id}.${n}`, vcc = supply(P('VCC')), v = variantOf(m.type, m.variant);
    const ok = powered() && vcc >= 2 && vcc <= 5.5 && hasGnd(P('GND')), base = { kind:'kit', ok, div:mo.jdiv, ilim:v.Iset, fcs:1, sigma:1, mapOk:true, clk:P('CLK') };
    if (mo.manual) return { ...base, en:ok, dir:mo.manual.dir, f:ok ? mo.manual.pps : 0, src:'manual', k:-1, step:ok };
    const c = clkFreq(P('CLK')), en = ok && level(P('EN')) === 1;
    return { ...base, en, dir:level(P('CW')) === 1 ? 1 : -1, f:ok ? c.f : 0, src:'mcu', k:c.k, step:en };
  }
  const cm = coilMap(m);
  if (!cm.drv) return { kind:'tb67', ok:false, en:false, dir:1, f:0, src:'none', k:-1, div:mo.div, ilim:0, fcs:1, sigma:1, mapOk:false, cm, step:false };
  const d = cm.drv, st = drvStatus(d, mo.manual), c = mo.manual ? { f:mo.manual.pps, k:-1 } : clkFreq(`${d.id}.CLK`);
  const en = st.out && cm.ok;
  return { kind:'tb67', drv:d, st, cm, ok:st.vmOk && !st.damaged, en, dir:st.dir, f:en && !st.rst ? c.f : 0, src:mo.manual ? 'manual' : 'mcu', k:c.k, div:st.div,
    ilim:st.ilim, fcs:Math.max(.3, Math.min(1.8, st.vm / 24)), sigma:cm.sigma, mapOk:cm.ok, step:en && !st.rst, clk:`${d.id}.CLK` };
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
function torqueMax(mp, omegaFs, inp){ return mp.v.T * Math.min(inp.ilim, mp.v.rated * 1.4) / mp.v.rated / (1 + Math.abs(omegaFs) / (mp.v.fc * inp.fcs)); }
const pushSeg = (mo, s) => { mo.seg = s; mo.hist.push(s); if (mo.hist.length > 4000) mo.hist.splice(0, 1000); };
/** 指令位置（全步）：σ × 微步計數 ÷ 微步 ＋ 位移。線序改變時重新對齊，讓轉子停在最近的平衡點 */
function alignMap(mo, inp){
  const key = inp.mapOk ? `${inp.sigma}|${inp.cm ? `${inp.cm.A.a}${inp.cm.A.b}${inp.cm.B.a}${inp.cm.B.b}` : 'kit'}` : '';
  if (!key || key === mo.mapKey) return;
  mo.mapKey = key;
  let pf = mo.ucnt / mo.div;                                                // 套件或正常接線：磁場就在微步計數的位置
  if (inp.cm && !inp.cm.normal){
    const e = Math.PI / 4 + mo.ucnt * (Math.PI / 2) / mo.div, I = { A:Math.cos(e), B:Math.sin(e) };
    const ia = inp.cm.A.s * I[inp.cm.A.ph], ib = inp.cm.B.s * I[inp.cm.B.ph];
    pf = (Math.atan2(ib, ia) - Math.PI / 4) / (Math.PI / 2);
  }
  let off = pf - inp.sigma * mo.ucnt / mo.div;
  off += Math.round((mo.theta - (inp.sigma * mo.ucnt / mo.div + off)) / 4) * 4;
  mo.off = off;
}
function advance(m, t1){
  const mo = motorOf(m), mp = motorParams(m);
  if (mo.lastT === null){ mo.lastT = t1; return; }
  let t = mo.lastT; if (t1 - t > 200) t = t1 - 200;          // 分頁在背景太久：只補最近 0.2 秒
  const inp = driverInputs(m);
  if (inp.div !== mo.div){ mo.ucnt = Math.round(mo.ucnt * inp.div / mo.div); mo.div = inp.div; }   // 改 MODE：電氣角不變
  alignMap(mo, inp);
  const div = mo.div, sg = inp.sigma, bbF = t1 - mo.bb.t < Math.max(60, 3000 / Math.max(1, mo.bb.f)) ? mo.bb.f : 0;
  // 輸入改變時開一個新的波形區段（給示波器畫 STEP 與線圈電流）
  const key = `${inp.f}|${inp.dir}|${inp.en}|${div}`;
  if (!mo.seg || mo.seg.key !== key) pushSeg(mo, { key, t, f:inp.en ? inp.f : 0, dir:inp.dir, en:inp.en, div, ucnt:mo.ucnt, acc:mo.acc });
  const k = mp.v.T * (Math.PI / 2) / mp.stepRad, zeta = .5, c = 2 * zeta * Math.sqrt(k * mp.J);
  const mag = div === 1 ? Math.SQRT2 : 1;                                    // 全步時兩組線圈都是 100%：合成磁場大 √2 倍
  while (t < t1){
    const dt = Math.min(SUB, t1 - t) / 1000;
    // 手動測試的脈波產生器每 5 ms 更新一次頻率（和韌體每 10 ms 更新一樣是一階一階的）
    if (mo.manual && t - (mo.manual.tu ?? -1e9) >= 5){
      const man = mo.manual; manualStep(man, man.tu === undefined ? 0 : (t - man.tu) / 1000); man.tu = t;
      if (inp.en && mo.seg.f !== man.pps) pushSeg(mo, { key:`${man.pps}|${inp.dir}|${inp.en}|${div}`, t, f:man.pps, dir:inp.dir, en:inp.en, div, ucnt:mo.ucnt, acc:mo.acc });
    }
    const f = inp.step ? (mo.manual ? mo.manual.pps : inp.f) : 0;
    mo.acc += f * dt; const n = Math.floor(mo.acc); mo.acc -= n; mo.ucnt += n * inp.dir;
    const cmd = sg * mo.ucnt / div + mo.off;                                  // 磁場（指令）位置，單位：全步
    const fieldW = sg * (f || bbF) / div * inp.dir;
    let T = 0;
    if (inp.en){
      const lag = cmd - mo.theta, e = lag - Math.round(lag / 4) * 4;
      // 失步後（mo.slip）電氣阻尼不再把轉子往磁場速度拉：轉子會慢下來、在原地抖動，直到磁場慢到又能把它拉回同步
      if (Math.abs(e) > 1.9) mo.slip = true;
      else if (mo.slip && Math.abs(e) < .5 && Math.abs(mo.omega - fieldW) < 40) mo.slip = false;
      const Tm = torqueMax(mp, mo.omega, inp) * mag;
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
      mo.samp.push({ t, cmdW:fieldW, w:mo.wf, cmd, theta:mo.theta, pps:f || bbF, dir:inp.dir, en:inp.en });
      if (mo.samp.length > 4000) mo.samp.splice(0, 1000);
    }
  }
  mo.lastT = t1;
}
export function stepperTick(now = performance.now()){
  for (const d of bench.modules) if (isDriver(d)) driverTick(d, now);
  for (const m of bench.modules) if (isStepper(m)) advance(m, now);
}
// DIR、EN、CLK 改變之前，先把運動積分到這一刻
pinPreListeners.push(() => { if (bench.modules.some(isMotorPart)) stepperTick(); });
// 用一般 GPIO 切換 CLK（例如 HAL_GPIO_TogglePin＋HAL_Delay）：每個上升緣前進一個微步
pinListeners.push((pin, v) => {
  for (const m of bench.modules){
    if (!isStepper(m)) continue;
    const mo = motorOf(m); if (mo.manual) continue;
    const inp = driverInputs(m); if (!inp.clk || !net(inp.clk).includes(pin)) continue;
    const now = performance.now();
    if (v === 1 && inp.step){
      mo.ucnt += inp.dir;
      const gap = now - mo.bb.t; mo.bb.f = gap > 0 && gap < 2000 ? (mo.bb.f ? mo.bb.f * .6 + 400 / gap : 1000 / gap) : 0; mo.bb.t = now;
    }
    pushSeg(mo, { key:`bb${now}`, t:now, f:0, lvl:v, dir:inp.dir, en:inp.en, div:mo.div, ucnt:mo.ucnt, acc:mo.acc });
  }
});

/* ---------- 給介面與示波器用 ---------- */
/** 某一時刻的波形區段索引 */
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
/** 驅動板輸出的線圈電流（相對於設定電流 −1…1）：微步依正弦／餘弦表，全步時兩組都是 ±100% */
export function coilCurrents(ucnt, div, en){
  if (!en) return [0, 0];
  const e = Math.PI / 4 + ucnt * (Math.PI / 2) / div;
  if (div === 1) return [Math.sign(Math.cos(e)) || 1, Math.sign(Math.sin(e)) || 1];
  return [Math.cos(e), Math.sin(e)];
}
export function motorInfo(m){
  const mo = motorOf(m), mp = motorParams(m), inp = driverInputs(m), now = performance.now();
  const lost = inp.mapOk ? Math.round((inp.sigma * mo.ucnt / mo.div + mo.off - mo.theta) / 4) * 4 : 0;
  const pps = inp.en ? inp.f || (now - mo.bb.t < 200 ? mo.bb.f : 0) : 0;
  return { div:mo.div, pps, dir:inp.dir, en:inp.en, ok:inp.ok, src:inp.src, k:inp.k, kind:inp.kind, inp,
    rps:(mo.wf || 0) / mp.fullSteps, rpm:(mo.wf || 0) / mp.fullSteps * 60, cmdRpm:pps / mo.div / mp.fullSteps * 60 * inp.dir * inp.sigma,
    deg:(((mo.theta / mp.fullSteps) * 360) % 360 + 360) % 360, revs:mo.theta / mp.fullSteps, lost, stalled: now - mo.stallT < 1500, stalls:mo.stalls,
    stepDeg:mp.v.step / mo.div, fullSteps:mp.fullSteps, perRev:mp.fullSteps * mo.div, maxJumpRps:jumpLimit(m), mp, ilim:inp.ilim };
}
/** 不加速、直接跳到某速度時大概不會失步的上限（圈／秒）：v² ≤ 2 × a_max × 1.5 全步 */
export function jumpLimit(m){ const mp = motorParams(m), inp = driverInputs(m), a = Math.max(0, torqueMax(mp, 0, inp) - mp.Tf) / mp.J; return Math.sqrt(2 * a * 1.5 * mp.stepRad) / (2 * Math.PI); }
/** 在某個速度（圈／秒）下還能有的最大加速度（圈／秒²） */
export function accelLimit(m, rps){ const mp = motorParams(m), inp = driverInputs(m), w = rps * mp.fullSteps, a = (torqueMax(mp, w, inp) - mp.Tf) / mp.J; return Math.max(0, a) / (2 * Math.PI); }
/** 微步設定：一體式套件改模組上的指撥開關；驅動板改 MODE 跳線（MODE 腳有接線時由接線決定，回傳 false） */
export function setDiv(m, div){
  stepperTick(); const d0 = USTEP.includes(div) ? div : 16;
  if (isDriver(m)){ if (drvStatus(m).modeWired) return false; drvOf(m).jdiv = d0; return true; }
  if (m.type === 'motor'){ const d = coilMap(m).drv; if (!d) return false; return setDiv(d, d0); }
  motorOf(m).jdiv = d0; return true;
}
export function setLoad(m, id){ stepperTick(); motorOf(m).load = LOADS[id] ? id : 1; }
/** 微步目前從哪裡決定、能不能用按鈕切換 */
export function divSource(m){
  if (m.type === 'stepper') return { div:motorOf(m).jdiv, can:true, how:'模組上的 DMODE 指撥開關' };
  const d = isDriver(m) ? m : coilMap(m).drv; if (!d) return { div:motorOf(m).div, can:false, how:'馬達還沒有接到驅動板' };
  const st = drvStatus(d);
  return st.modeWired ? { div:st.div, can:false, how:`MODE2..0 有接線（${dmodeBits(st.div)}），由接線的電位決定` } : { div:st.div, can:true, how:'MODE0–2 沒接線，用驅動板上的跳線決定' };
}
