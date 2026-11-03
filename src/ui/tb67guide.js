// TB67S128FTG 驅動板的「每一支腳怎麼接」：接線圖（SVG）與接線表，依目前的實際接線即時判斷對錯
import { esc } from './dom.js';
import { MODULE_TYPES, variantOf } from '../core/parts.js';
import { bench, wires, net, netInfo, nodeOf, PINS, headerPin, moduleLabel, moduleById, drvVin } from '../core/sim.js';
import { coilMap, drvStatus, motorOfDriver, dmodeBits, ustepName } from '../core/steppers.js';

const LEFT = ['GND', 'IOREF', 'STBY', 'EN', 'RST', 'CLK', 'DIR', 'MODE0', 'MODE1', 'MODE2', 'LO0', 'LO1'];
const RIGHT = ['VIN', 'PGND', 'VCC', 'A+', 'A-', 'B+', 'B-'];
const COIL = { 'A+':'黑', 'A-':'綠', 'B+':'紅', 'B-':'藍' };
const disp = n => n.replace('-', '−');

/** 這支腳目前接到哪裡（排針名稱、電源、其他模組的腳） */
function connected(id){
  const ms = new Set(net(id)), i = netInfo(id), out = [];
  const b = bench.board;
  for (const g of i.gpio){ const h = b.header.find(x => x.mcu === g); out.push(h && h.label !== g ? `${h.label}（${g}）` : g); }
  if (i.v33) out.push('3V3'); if (i.v5) out.push('5V'); if (i.gnd) out.push('MCU GND');
  // 只列出和步進馬達有關的模組；其他模組（LED、感測器…的 GND／VCC）合併成一個數字。驅動板自己板上相通的腳（GND／PGND）不列
  const seen = new Set(), self = id.split('.')[0]; let others = 0;
  for (const w of wires) for (const x of [w.a, w.b]){
    if (x === id || seen.has(x) || PINS[x]?.kind !== 'mod' || !ms.has(nodeOf(x))) continue;
    seen.add(x);
    const m = moduleById(x.split('.')[0]);
    if (x.startsWith(self + '.') && !/LO[01]$/.test(x)) continue;
    if (!['tb67', 'motor', 'psu'].includes(m?.type)){ others++; continue; }
    out.push(PINS[x].label.replace('-', '−'));
  }
  if (others) out.push(`＋其他 ${others} 個模組`);
  return out;
}

/** 每一支腳：功能、應該接到哪裡、目前接到哪裡、狀態（ok／err／warn／opt＝可不接／info） */
export function pinRows(d){
  const P = n => `${d.id}.${n}`, st = drvStatus(d), b = bench.board, I = n => netInfo(P(n)), wired = n => net(P(n)).length > 1;
  const mot = motorOfDriver(d), cm = mot ? coilMap(mot) : null, psu = bench.modules.find(m => m.type === 'psu');
  const stepList = b.step ? b.step.map(x => `${x.pin}（${x.tim}）`).join(' 或 ') : '一支 GPIO';
  const T = MODULE_TYPES.tb67, func = n => T.pins.find(p => p[0] === n)[1];
  const isStep = n => b.step && I(n).gpio.some(g => b.step.some(x => headerPin(x.pin)?.mcu === g));
  const rows = [];
  const row = (n, want, sev, note = '') => rows.push({ n, side:RIGHT.includes(n) ? 'R' : 'L', want, now:connected(P(n)), sev, note, func:func(n) });
  const logic = (n, want, needHigh, optional) => {
    const i = I(n);
    if (i.src > 5.5) return row(n, want, 'err', '接到馬達電源：會燒毀');
    if (!wired(n)) return row(n, want, optional ? 'opt' : needHigh ? 'err' : 'opt', needHigh ? '沒接＝低電位' : '');
    if (i.gpio.length) return row(n, want, 'ok');
    if (i.v33 || i.v5 || i.src) return row(n, want, needHigh ? 'ok' : n === 'RST' ? 'err' : 'info', needHigh ? '固定高電位' : n === 'RST' ? '一直在重設' : '固定高電位');
    if (i.gnd) return row(n, want, needHigh ? 'err' : 'ok', needHigh ? '固定低電位' : '固定低電位');
    return row(n, want, 'warn', '沒有接到 MCU');
  };
  row('GND', 'MCU 的 GND（排針 GND 或電源軌 −）', I('GND').gnd ? 'ok' : 'err', I('GND').gnd ? '' : '沒有共地');
  const io = I('IOREF');
  row('IOREF', '3V3（和 MCU 一樣的邏輯電壓）', io.src ? 'err' : io.v33 ? 'ok' : io.v5 ? 'warn' : wired('IOREF') ? 'err' : 'warn', io.v5 ? 'LO 旗標會是 5 V' : !wired('IOREF') ? '讀不到錯誤旗標' : '');
  logic('STBY', 'MCU 的 GPIO（輸出，開機設高電位）', true);
  logic('EN', 'MCU 的 GPIO（輸出，高電位送電）', true);
  logic('RST', '不接，或接 GND（保持低電位）', false, true);
  const ci = I('CLK');
  row('CLK', `計時器 PWM 腳：${stepList}`, ci.src > 5.5 ? 'err' : !wired('CLK') ? 'err' : isStep('CLK') ? 'ok' : ci.gpio.length ? 'warn' : 'err', !wired('CLK') ? '沒接就不會動' : ci.gpio.length && !isStep('CLK') ? '一般 GPIO：只能慢慢送' : '');
  logic('DIR', 'MCU 的 GPIO（輸出，高電位順時針）', false, true);
  for (const n of ['MODE0', 'MODE1', 'MODE2']){
    const k = +n.slice(-1), bit = (USTEP_BITS(st.div) >> k) & 1;
    row(n, '不接（用板上跳線），或接 GPIO／3V3／GND', I(n).src > 5.5 ? 'err' : 'info', st.modeWired ? `＝${bit ? '高' : '低'}` : `跳線＝${bit ? '高' : '低'}`);
  }
  const lo = n => { const i = I(n); if (i.v33 || i.v5 || i.gnd || i.src) return 'err'; if (i.gpio.length || (n === 'LO1' && net(P('LO1')).includes(P('LO0')) && I('LO0').gpio.length)) return 'ok'; return 'opt'; };
  row('LO0', 'MCU 的 GPIO（輸入，低電位＝錯誤）', lo('LO0'));
  row('LO1', '並接到 LO0（或另一支 GPIO 輸入）', lo('LO1'));
  const vm = drvVin(d), psuOk = net(P('VIN')).some(x => /\.V\+$/.test(x));
  row('VIN', `馬達電源 V+（6.5–44 V）${psu ? `：${moduleLabel(psu)} V+` : ''}`, vm >= 6.5 && psuOk ? 'ok' : 'err', vm && vm < 6.5 ? `只有 ${vm} V` : !psuOk && wired('VIN') ? '不是馬達電源' : '');
  row('PGND', `馬達電源 V−${psu ? `：${moduleLabel(psu)} V−` : ''}`, net(P('PGND')).some(x => /\.V-$/.test(x)) ? 'ok' : wired('VIN') ? 'err' : 'opt');
  const vc = I('VCC');
  row('VCC', '不接（5 V 輸出，只能拉高邏輯腳）', vc.v33 || vc.v5 || vc.gnd || vc.gpio.length ? 'err' : wired('VCC') ? 'ok' : 'opt');
  for (const n of ['A+', 'A-', 'B+', 'B-']){
    const mt = net(P(n)).filter(x => moduleById(x.split('.')[0])?.type === 'motor').map(x => x.split('.')[1]), i = I(n);
    const shorted = i.gnd || i.v33 || i.v5 || i.gpio.length || i.src || net(P(n)).some(x => x !== P(n) && x.startsWith(d.id + '.'));
    const sev = shorted ? 'err' : !mt.length ? 'err' : mt[0] === n ? 'ok' : cm && cm.ok ? 'info' : 'err';
    row(n, `馬達 ${disp(n)}（常見${COIL[n]}線）`, sev, shorted ? '短路' : !mt.length ? '沒接' : mt[0] !== n ? `接到馬達 ${disp(mt[0])}${cm && cm.ok ? (cm.sigma < 0 ? '：會反轉' : '') : '：接錯相'}` : '');
  }
  return { rows, st, mot, psu, cm };
}
const USTEP_BITS = div => Math.log2(div);

const SEV = { ok:['✓', '正確'], err:['✕', '要修正'], warn:['!', '注意'], opt:['–', '可不接'], info:['i', '說明'] };
export function pinTable(d){
  const { rows, st } = pinRows(d);
  const errs = rows.filter(r => r.sev === 'err').length;
  return `<p class="note">${errs ? `還有 <b class="tb-bad">${errs}</b> 支腳要修正。` : '必要的腳都接對了。'}微步 ${ustepName(st.div)}（MODE2..0 ＝ ${dmodeBits(st.div)}，${st.modeWired ? '由接線決定' : '用板上跳線'}）。點一列可以在 3D 畫面上標出那支腳。</p>
  <div class="tb-tbl" role="table" aria-label="TB67S128FTG 每一支腳的接法">
    <div class="tb-h" role="row"><span role="columnheader">腳位</span><span role="columnheader">應該接到</span><span role="columnheader">目前接到</span></div>
    ${rows.map(r => `<button type="button" class="tb-r ${r.sev}" data-act="pinmark" data-id="${esc(d.id + '.' + r.n)}" role="row">
      <span class="tb-n" role="cell"><i aria-label="${SEV[r.sev][1]}">${SEV[r.sev][0]}</i><b>${esc(disp(r.n))}</b><small>${r.side === 'R' ? '右側' : '左側'}</small></span>
      <span class="tb-want" role="cell">${esc(r.want)}<small>${esc(r.func)}</small></span>
      <span class="tb-now" role="cell">${r.now.length ? r.now.map(esc).join('<br>') : '<em>（沒接）</em>'}${r.note ? `<small class="${r.sev}">${esc(r.note)}</small>` : ''}</span>
    </button>`).join('')}
  </div>`;
}

/** 接線圖：MCU ── TB67S128FTG ── 馬達電源／馬達。線的顏色＝狀態 */
export function wiringSvg(d){
  const { rows, mot, psu, cm } = pinRows(d), P = n => `${d.id}.${n}`, by = Object.fromEntries(rows.map(r => [r.n, r]));
  const yL = n => 44 + LEFT.indexOf(n) * 23, yR = { VIN:50, PGND:74, VCC:108, 'A+':196, 'A-':220, 'B+':244, 'B-':268 };
  const col = s => `tb-s-${s}`;
  const parts = [];
  // 方塊
  parts.push(`<rect class="tb-box" x="4" y="26" width="84" height="296" rx="6"/><text class="tb-t" x="46" y="18" text-anchor="middle">MCU</text><text class="tb-m" x="46" y="316" text-anchor="middle">${esc(bench.board.mcu.slice(0, 13))}</text>`);
  parts.push(`<rect class="tb-box tb-drv" x="126" y="6" width="108" height="324" rx="6"/><text class="tb-t" x="180" y="24" text-anchor="middle">${esc(moduleLabel(d))}</text><text class="tb-m" x="180" y="322" text-anchor="middle">TB67S128FTG</text>`);
  parts.push(psu ? `<rect class="tb-box" x="276" y="34" width="80" height="54" rx="6"/><text class="tb-t" x="316" y="58" text-anchor="middle">${esc(moduleLabel(psu))}</text><text class="tb-m" x="316" y="74" text-anchor="middle">${variantOf(psu.type, psu.variant).v} V ${psu.st.on === false ? '（關）' : ''}</text>`
    : `<rect class="tb-box tb-miss" x="276" y="34" width="80" height="54" rx="6"/><text class="tb-m" x="316" y="58" text-anchor="middle">還沒有</text><text class="tb-m" x="316" y="72" text-anchor="middle">馬達電源</text>`);
  parts.push(mot ? `<rect class="tb-box" x="276" y="180" width="80" height="104" rx="6"/><circle class="tb-mot" cx="326" cy="232" r="20"/><text class="tb-t" x="326" y="236" text-anchor="middle">M</text><text class="tb-m" x="316" y="176" text-anchor="middle">${esc(moduleLabel(mot))}</text>`
    : `<rect class="tb-box tb-miss" x="276" y="180" width="80" height="104" rx="6"/><text class="tb-m" x="316" y="228" text-anchor="middle">還沒有</text><text class="tb-m" x="316" y="242" text-anchor="middle">接馬達</text>`);
  // 左側：MCU ↔ 驅動板
  for (const n of LEFT){
    const r = by[n], y = yL(n), i = netInfo(P(n)), wired = net(P(n)).length > 1;
    const tag = i.gpio.length ? (bench.board.header.find(h => h.mcu === i.gpio[0])?.label || i.gpio[0]) : i.v33 ? '3V3' : i.v5 ? '5V' : i.gnd ? 'GND' : i.src ? `${i.src}V` : n === 'LO1' && net(P('LO1')).includes(P('LO0')) ? '↑LO0' : '';
    parts.push(`<text class="tb-p" x="132" y="${y + 3.5}">${disp(n)}</text>`);
    if (n === 'LO1' && net(P('LO1')).includes(P('LO0'))){ parts.push(`<path class="tb-w ${col(r.sev)}" d="M126 ${y} h-10 V${yL('LO0')} h10"/>`); continue; }
    if (!wired){ parts.push(`<path class="tb-w ${col(r.sev)} tb-dash" d="M126 ${y} h-22"/>`); if (r.sev === 'err') parts.push(`<text class="tb-x" x="98" y="${y + 3.5}" text-anchor="end">✕</text>`); continue; }
    if (tag){ parts.push(`<path class="tb-w ${col(r.sev)}" d="M88 ${y} H126"/><circle class="tb-dot ${col(r.sev)}" cx="88" cy="${y}" r="2.6"/><text class="tb-q" x="84" y="${y + 3.5}" text-anchor="end">${esc(tag)}</text>`); }
    else parts.push(`<path class="tb-w ${col(r.sev)} tb-dash" d="M126 ${y} h-22"/>`);
  }
  // 右側：驅動板 ↔ 電源、馬達（依實際接法畫線，接反的線會交叉）
  for (const n of RIGHT){
    const r = by[n], y = yR[n];
    parts.push(`<text class="tb-p" x="228" y="${y + 3.5}" text-anchor="end">${disp(n)}</text>`);
    const ms = net(P(n));
    let ty = null;
    if (n === 'VIN' && psu && ms.includes(`${psu.id}.V+`)) ty = 50; else if (n === 'VIN' && psu && ms.includes(`${psu.id}.V-`)) ty = 74;
    if (n === 'PGND' && psu && ms.includes(`${psu.id}.V-`)) ty = 74; else if (n === 'PGND' && psu && ms.includes(`${psu.id}.V+`)) ty = 50;
    if (mot && ['A+', 'A-', 'B+', 'B-'].includes(n)){ const t = ms.find(x => x.startsWith(mot.id + '.')); if (t) ty = yR[t.split('.')[1]]; }
    if (ty !== null) parts.push(`<path class="tb-w ${col(r.sev)}" d="M234 ${y} C254 ${y} 256 ${ty} 276 ${ty}"/><circle class="tb-dot ${col(r.sev)}" cx="276" cy="${ty}" r="2.6"/>`);
    else if (net(P(n)).length > 1) parts.push(`<path class="tb-w ${col(r.sev)}" d="M234 ${y} h22"/><text class="tb-x" x="262" y="${y + 3.5}">?</text>`);
    else parts.push(`<path class="tb-w ${col(r.sev)} tb-dash" d="M234 ${y} h20"/>`);
  }
  if (psu) parts.push(`<text class="tb-q" x="280" y="53">V+</text><text class="tb-q" x="280" y="77">V−</text>`);
  if (mot) for (const n of ['A+', 'A-', 'B+', 'B-']) parts.push(`<text class="tb-q" x="280" y="${yR[n] + 3.5}">${disp(n)}</text>`);
  // 共地：馬達電源的 V− 經過驅動板的 GND 和 MCU 相通
  if (cm && cm.ok && !cm.normal) parts.push(`<text class="tb-m tb-s-info" x="316" y="300" text-anchor="middle">${cm.sigma < 0 ? '線序相反：會反轉' : '兩組都反接：方向不變'}</text>`);
  return `<svg class="tb-svg" viewBox="0 0 360 334" role="img" aria-label="接線圖：MCU、TB67S128FTG 驅動板、馬達電源與步進馬達之間每一條線">${parts.join('')}</svg>
  <p class="tb-leg"><span class="tb-s-ok">━ 正確</span><span class="tb-s-err">━ 要修正</span><span class="tb-s-warn">━ 注意</span><span class="tb-s-opt">┅ 可不接</span></p>
  <p class="note">${psu && netInfo(P('GND')).gnd && net(P('PGND')).includes(`${psu.id}.V-`) ? '✓ 共地：左側 GND 和右側 PGND 在板上相通，所以馬達電源的 V− 和 MCU 的 GND 連在一起了。' : '左側 GND 和右側 PGND 在板上相通：GND 接 MCU、PGND 接馬達電源 V−，兩邊就共地了。'}左邊的線接 MCU（小電流的邏輯訊號），右邊的線接馬達電源和馬達（大電流）。</p>`;
}
