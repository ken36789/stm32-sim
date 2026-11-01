// 通訊協定的純函式：CAN 訊框編碼（CRC-15、位元填充）、取樣（依取樣率量化邊緣）與 I2C／UART／SPI／CAN 解碼器。
// 訊號格式：{ init, t:[微秒…], v:[0|1…] }，v[i] 是 t[i] 之後的電位。
// 解碼結果：{ anns:[{ t0, t1, row, kind, label, short, d }], stats:{} }

/* ---------- 訊號工具 ---------- */
export function levelAt(sig, t){
  const T = sig.t; let lo = 0, hi = T.length - 1, k = -1;
  while (lo <= hi){ const mid = (lo + hi) >> 1; if (T[mid] <= t){ k = mid; lo = mid + 1; } else hi = mid - 1; }
  return k < 0 ? sig.init : sig.v[k];
}
export const constSig = v => ({ init:v, t:[], v:[] });
/** 第一個時間大於 t 的邊緣索引（二分搜尋） */
export function idxAfter(sig, t){ let lo = 0, hi = sig.t.length; while (lo < hi){ const mid = (lo + hi) >> 1; if (sig.t[mid] > t) hi = mid; else lo = mid + 1; } return lo; }
const nextEdge = (sig, t) => { const i = idxAfter(sig, t); return i < sig.t.length ? sig.t[i] : t; };
const prevEdge = (sig, t) => { let i = idxAfter(sig, t - 1e-9) - 1; return i >= 0 ? sig.t[i] : t; };
function mergeTimes(...sigs){ const s = new Set(); for (const g of sigs) if (g) for (const t of g.t) s.add(t); return [...s].sort((a, b) => a - b); }

/** 依取樣率量化：邊緣移到下一個取樣點；兩個邊緣落在同一個取樣點時，這個脈衝就看不到了 */
export function sampleSig(sig, fs, t0 = 0){
  const P = 1e6 / fs, t = [], v = [];
  const cur = () => v.length ? v[v.length - 1] : sig.init;
  for (let i = 0; i < sig.t.length; i++){
    const q = t0 + Math.ceil((sig.t[i] - t0) / P - 1e-9) * P;
    if (t.length && Math.abs(q - t[t.length - 1]) < 1e-9){ t.pop(); v.pop(); }
    if (cur() !== sig.v[i]){ t.push(q); v.push(sig.v[i]); }
  }
  return { init:sig.init, t, v };
}
/** 訊號中最短的脈衝寬度（微秒），用來估計鮑率或時脈 */
export function minPulse(sig){
  let m = Infinity; for (let i = 1; i < sig.t.length; i++){ const d = sig.t[i] - sig.t[i - 1]; if (d > 1e-6 && d < m) m = d; }
  return m;
}
export const STD_BAUD = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
export const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/* ---------- CAN 訊框（CAN 2.0A 標準格式） ---------- */
export function crc15(bits){
  let crc = 0;
  for (const b of bits){ const nxt = b ^ ((crc >> 14) & 1); crc = (crc << 1) & 0x7FFF; if (nxt) crc ^= 0x4599; }
  return crc;
}
/** 回傳實際上線的位元：[{ b, f:欄位, stuff? }]。SOF 到 CRC 之間每 5 個相同位元插入 1 個相反的填充位元 */
export function canFrameBits(id, data, rtr = false){
  const raw = [], push = (f, val, n) => { for (let k = n - 1; k >= 0; k--) raw.push({ b:(val >> k) & 1, f }); };
  const len = Math.min(data.length, 8);
  push('sof', 0, 1); push('id', id & 0x7FF, 11); push('rtr', rtr ? 1 : 0, 1); push('ide', 0, 1); push('r0', 0, 1); push('dlc', len, 4);
  if (!rtr) data.slice(0, 8).forEach(x => push('data', x & 0xFF, 8));
  const crc = crc15(raw.map(x => x.b)); push('crc', crc, 15);
  const out = []; let run = 0, last = -1;
  for (const x of raw){
    out.push(x);
    if (x.b === last) run++; else { run = 1; last = x.b; }
    if (run === 5){ const s = 1 - last; out.push({ b:s, f:x.f, stuff:true }); last = s; run = 1; }
  }
  out.push({ b:1, f:'crcdel' }, { b:1, f:'ack' }, { b:1, f:'ackdel' });
  for (let k = 0; k < 7; k++) out.push({ b:1, f:'eof' });
  return Object.assign(out, { crc });
}

/* ---------- I2C ---------- */
export function decodeI2C(scl, sda){
  const anns = [], highs = [];
  let pS = scl.init, pD = sda.init, st = 'idle', bits = [], rw = 0, nByte = 0, pkt = null;
  const A = (t0, t1, row, kind, label, short, d = {}) => anns.push({ t0, t1:Math.max(t1, t0 + .05), row, kind, label, short, d });
  const closePkt = t => {
    if (!pkt) return;
    const txt = pkt.segs.filter(s => s.addr !== null).map(s => `${s.rw ? '讀' : '寫'} 0x${hex2(s.addr)}${s.nak ? '（NACK）' : s.bytes.length ? '：' + s.bytes.map(hex2).join(' ') : ''}`).join(' → ');
    A(pkt.t0, t, 'packets', 'packet', txt || '（不完整）', pkt.segs.some(s => s.nak) ? 'NACK' : 'I2C', { segs:pkt.segs });
    pkt = null;
  };
  for (const t of mergeTimes(scl, sda)){
    const S = levelAt(scl, t), D = levelAt(sda, t);
    if (pS === 1 && S === 1 && pD === 1 && D === 0){
      const rs = st !== 'idle';
      if (bits.length) A(bits[0].t0, t, 'fields', 'err', `只收到 ${bits.length} 個位元就重新起始`, '?', { n:bits.length });
      A(t, nextEdge(scl, t), 'fields', rs ? 'rstart' : 'start', rs ? '重複起始 Sr' : '起始 START', rs ? 'Sr' : 'S');
      if (!pkt) pkt = { t0:t, segs:[] };
      pkt.segs.push({ addr:null, rw:0, bytes:[], nak:false });
      st = 'addr'; bits = []; nByte = 0;
    } else if (pS === 1 && S === 1 && pD === 0 && D === 1){
      if (bits.length) A(bits[0].t0, t, 'fields', 'err', `位元組只收到 ${bits.length} 個位元`, '?', { n:bits.length });
      A(prevEdge(scl, t), t, 'fields', 'stop', '停止 STOP', 'P');
      closePkt(t); st = 'idle'; bits = [];
    } else if (pS === 0 && S === 1){
      if (st !== 'idle') bits.push({ v:D, t0:t });
    } else if (pS === 1 && S === 0 && st !== 'idle' && bits.length && bits[bits.length - 1].t1 === undefined){
      const b = bits[bits.length - 1]; b.t1 = t; highs.push(t - b.t0);
      const k = bits.length - 1;
      A(b.t0, t, 'bits', 'bit', String(b.v), String(b.v), { v:b.v, k, ack:k === 8 });
      if (bits.length === 9){
        const val = bits.slice(0, 8).reduce((a, x) => (a << 1) | x.v, 0), ack = bits[8].v, seg = pkt?.segs[pkt.segs.length - 1];
        if (st === 'addr'){
          rw = val & 1;
          A(bits[0].t0, bits[7].t1, 'fields', 'addr', `位址 0x${hex2(val >> 1)} · ${rw ? '讀' : '寫'}`, `${rw ? 'R' : 'W'} ${hex2(val >> 1)}`, { addr:val >> 1, rw, value:val });
          if (seg){ seg.addr = val >> 1; seg.rw = rw; seg.nak = !!ack; }
          st = rw ? 'read' : 'write';
        } else {
          A(bits[0].t0, bits[7].t1, 'fields', 'data', `資料 0x${hex2(val)}`, hex2(val), { value:val, rw, index:nByte, addr:seg?.addr });
          if (seg) seg.bytes.push(val);
          nByte++;
        }
        const who = st === 'read' && nByte > 0 ? '主機' : '從機';
        A(bits[8].t0, bits[8].t1, 'fields', ack ? 'nack' : 'ack', ack ? 'NACK' : 'ACK', ack ? 'N' : 'A', { who, after: nByte ? 'data' : 'addr', last: st === 'read' && ack === 1 });
        bits = [];
      }
    }
    pS = S; pD = D;
  }
  if (pkt) closePkt(Math.max(pkt.t0, scl.t[scl.t.length - 1] || 0, sda.t[sda.t.length - 1] || 0));
  const rises = []; let last = null; for (let i = 0; i < scl.t.length; i++) if (scl.v[i] === 1){ if (last !== null && scl.t[i] - last < 50) rises.push(scl.t[i] - last); last = scl.t[i]; }
  const per = median(rises);
  return { anns, stats:{ sclHz: per ? 1e6 / per : 0, highUs: median(highs), packets:anns.filter(a => a.kind === 'packet').length, nacks:anns.filter(a => a.kind === 'nack' && a.d.after === 'addr').length } };
}

/* ---------- UART（8N1 為預設） ---------- */
export function decodeUART(line, o = {}){
  const baud = o.baud || 115200, nb = o.bits || 8, par = o.parity || 'none', Tb = 1e6 / baud, anns = [], bytes = [];
  const A = (t0, t1, row, kind, label, short, d = {}) => anns.push({ t0, t1, row, kind, label, short, d });
  const frameBits = 1 + nb + (par === 'none' ? 0 : 1) + 1;
  let from = -Infinity;
  for (let i = 0; i < line.t.length; i++){
    if (line.v[i] !== 0 || line.t[i] < from) continue;
    const t = line.t[i];
    if (levelAt(line, t + Tb / 2) !== 0){ continue; }               // 太短的雜訊，不是起始位元
    A(t, t + Tb, 'bits', 'ustart', 'S', 'S');
    let val = 0;
    for (let k = 0; k < nb; k++){ const b = levelAt(line, t + (1.5 + k) * Tb); val |= b << k; A(t + (1 + k) * Tb, t + (2 + k) * Tb, 'bits', 'ubit', String(b), String(b), { k, v:b }); }
    let off = 1 + nb, perr = false;
    if (par !== 'none'){ const p = levelAt(line, t + (off + .5) * Tb), ones = [...val.toString(2)].filter(c => c === '1').length + p; perr = par === 'even' ? ones % 2 !== 0 : ones % 2 !== 1; A(t + off * Tb, t + (off + 1) * Tb, 'bits', 'upar', 'P', 'P', { v:p, err:perr }); off++; }
    const stop = levelAt(line, t + (off + .5) * Tb), ferr = stop !== 1;
    A(t + off * Tb, t + (off + 1) * Tb, 'bits', ferr ? 'uferr' : 'ustop', ferr ? '停止位元錯誤' : 'E', ferr ? '!' : 'E', { v:stop });
    const ch = val >= 32 && val < 127 ? `'${String.fromCharCode(val)}'` : val === 10 ? '\\n' : val === 13 ? '\\r' : '';
    A(t, t + frameBits * Tb, 'bytes', ferr || perr ? 'uerr' : 'ubyte', `0x${hex2(val)} ${ch}`.trim(), hex2(val), { value:val, ferr, perr, ch });
    bytes.push({ t0:t, t1:t + frameBits * Tb, v:val, bad:ferr || perr });
    from = t + (off + .5) * Tb;
  }
  // 依換行或停頓分段，顯示成文字
  let seg = [];
  const flush = () => {
    if (!seg.length) return;
    let text; try { text = new TextDecoder('utf-8', { fatal:false }).decode(new Uint8Array(seg.map(x => x.v))); } catch (_){ text = seg.map(x => String.fromCharCode(x.v)).join(''); }
    const shown = text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    A(seg[0].t0, seg[seg.length - 1].t1, 'packets', seg.some(x => x.bad) ? 'utextbad' : 'utext', `“${shown}”`, `${seg.length} B`, { text, n:seg.length, bad:seg.filter(x => x.bad).length });
    seg = [];
  };
  bytes.forEach((b, i) => { if (seg.length && b.t0 - seg[seg.length - 1].t1 > 3 * frameBits * Tb) flush(); seg.push(b); if (b.v === 10 || i === bytes.length - 1) flush(); });
  const mp = minPulse(line), est = mp < Infinity ? 1e6 / mp : 0, std = STD_BAUD.find(r => Math.abs(r - est) / r < .06) || 0;
  return { anns, stats:{ bytes:bytes.length, errors:bytes.filter(b => b.bad).length, estBaud:est, stdBaud:std } };
}

/* ---------- SPI ---------- */
export function decodeSPI(sck, mosi, miso, cs, o = {}){
  const cpol = o.cpol || 0, cpha = o.cpha || 0, anns = [], pers = [];
  const A = (t0, t1, row, kind, label, short, d = {}) => anns.push({ t0, t1, row, kind, label, short, d });
  const sampleLevel = (cpol === 0) === (cpha === 0) ? 1 : 0;   // 模式 0、3 在上升緣取樣；模式 1、2 在下降緣
  const frames = [];
  if (cs){
    let start = cs.init === 0 ? -Infinity : null;
    for (let i = 0; i < cs.t.length; i++){
      if (cs.v[i] === 0 && start === null) start = cs.t[i];
      else if (cs.v[i] === 1 && start !== null){ frames.push([start, cs.t[i]]); start = null; }
    }
    if (start !== null) frames.push([start, Infinity]);
  } else frames.push([-Infinity, Infinity]);
  for (const [f0, f1] of frames){
    const edges = []; for (let i = Number.isFinite(f0) ? idxAfter(sck, f0) : 0; i < sck.t.length && sck.t[i] < f1; i++) edges.push(i);
    const samp = edges.filter(i => sck.v[i] === sampleLevel).map(i => sck.t[i]);
    for (let k = 1; k < samp.length; k++) pers.push(samp[k] - samp[k - 1]);
    const per = median(pers) || 1, mo = [], mi = [];
    let cur = [], bytesMo = [], bytesMi = [];
    samp.forEach((t, k) => {
      const a = levelAt(mosi, t), b = miso ? levelAt(miso, t) : 1;
      cur.push({ t, a, b });
      A(t - per / 2, t + per / 2, 'bits', 'sbit', String(a), String(a), { k:cur.length - 1, mosi:a, miso:b });
      if (cur.length === 8){
        const va = cur.reduce((x, c) => (x << 1) | c.a, 0), vb = cur.reduce((x, c) => (x << 1) | c.b, 0), t0 = cur[0].t - per / 2, t1 = cur[7].t + per / 2;
        A(t0, t1, 'mosi', 'smosi', `0x${hex2(va)}`, hex2(va), { value:va, index:bytesMo.length });
        A(t0, t1, 'miso', 'smiso', `0x${hex2(vb)}`, hex2(vb), { value:vb, index:bytesMi.length });
        bytesMo.push(va); bytesMi.push(vb); mo.push(va); mi.push(vb); cur = [];
      }
      if (k === samp.length - 1 && cur.length) A(cur[0].t - per / 2, t + per / 2, 'mosi', 'serr', `只有 ${cur.length} 個位元`, '?', { n:cur.length });
    });
    if (cs && Number.isFinite(f0)) A(f0, Number.isFinite(f1) ? f1 : (samp[samp.length - 1] || f0) + per, 'packets', bytesMo.length ? 'sframe' : 'sempty',
      bytesMo.length ? `MOSI ${bytesMo.map(hex2).join(' ')} ｜ MISO ${bytesMi.map(hex2).join(' ')}` : 'CS 拉低，但沒有時脈', `${bytesMo.length} B`, { mosi:bytesMo, miso:bytesMi });
  }
  const per = median(pers);
  return { anns, stats:{ sckHz: per ? 1e6 / per : 0, frames:anns.filter(a => a.kind === 'sframe').length } };
}

/* ---------- CAN ---------- */
const CAN_FIELD = { sof:'SOF', id:'識別碼 ID', rtr:'RTR', ide:'IDE', r0:'r0', dlc:'DLC', data:'資料', crc:'CRC', crcdel:'CRC 分隔', ack:'ACK 槽', ackdel:'ACK 分隔', eof:'EOF' };
export function decodeCAN(bus, o = {}){
  const rate = o.bitrate || 500e3, T = 1e6 / rate, anns = [];
  const A = (t0, t1, row, kind, label, short, d = {}) => anns.push({ t0, t1, row, kind, label, short, d });
  let from = -Infinity, frames = 0, errs = 0;
  for (let i = 0; i < bus.t.length; i++){
    if (bus.v[i] !== 0 || bus.t[i] < from) continue;
    const tSof = bus.t[i], prevT = i ? bus.t[i - 1] : -Infinity;
    if (tSof - prevT < 10.5 * T && i > 0){ continue; }                 // 匯流排閒置不足 11 個位元，不是新訊框
    // 逐位元取樣（取樣點 70%，遇到隱性→顯性邊緣重新同步）
    let ts = tSof, run = 0, last = -1, stuffZone = true, tailStuff = false, n = 0;
    const fields = [], got = { id:0, rtr:0, ide:0, r0:0, dlc:0, data:[], crc:0 }, raw = [];
    let need = [['sof', 1], ['id', 11], ['rtr', 1], ['ide', 1], ['r0', 1], ['dlc', 4]], fi = 0, fcount = 0, fstart = ts, err = null;
    const nextStart = s => { for (let k = idxAfter(bus, s + .5 * T); k < bus.t.length; k++){ const e = bus.t[k]; if (e >= s + 1.5 * T) break; if (bus.v[k] === 0) return e; } return s + T; };
    while (fi < need.length && n < 200){
      const b = levelAt(bus, ts + .7 * T), te = ts + T;
      if ((stuffZone || tailStuff) && run === 5){
        tailStuff = false;
        if (b === last){ err = { t0:ts, t1:te, kind:'cstufferr', label:'填充錯誤（連續 6 個相同位元）' }; break; }
        A(ts, te, 'bits', 'cstuff', String(b), 'S', { v:b }); last = b; run = 1; ts = nextStart(ts); n++; continue;
      }
      if (stuffZone){ if (b === last) run++; else { run = 1; last = b; } }
      const [f, len] = need[fi];
      A(ts, te, 'bits', 'cbit', String(b), String(b), { v:b, f });
      raw.push(b);
      if (fcount === 0) fstart = ts;
      fcount++;
      if (f === 'id') got.id = (got.id << 1) | b; else if (f === 'dlc') got.dlc = (got.dlc << 1) | b; else if (f === 'crc') got.crc = (got.crc << 1) | b;
      else if (f === 'data'){ const k = Math.floor((fcount - 1) / 8); got.data[k] = ((got.data[k] || 0) << 1) | b; } else if (f in got) got[f] = b;
      else if (f === 'ack') got.ackBit = b; else if (f === 'crcdel') got.crcdel = b; else if (f === 'eof') got.eofBad = (got.eofBad || 0) + (b === 0 ? 1 : 0);
      else if (f === 'ackdel'){ got.ackdel = b; if (b === 0){ got.errflag = ts; anns.pop(); raw.pop(); break; } }
      if (fcount === len){
        fields.push({ f, t0:fstart, t1:te });
        fcount = 0; fi++;
        if (f === 'dlc'){ const nd = got.rtr ? 0 : Math.min(got.dlc, 8); need = need.concat(nd ? [['data', nd * 8]] : [], [['crc', 15]]); if (got.ide) { err = { t0:fstart, t1:te, kind:'cerr', label:'延伸格式（29 位元 ID）不在本解碼器範圍' }; } }
        if (f === 'crc'){ stuffZone = false; tailStuff = run === 5; need = need.concat([['crcdel', 1], ['ack', 1], ['ackdel', 1], ['eof', 7]]); }   // CRC 最後 5 個位元相同時，後面還有一個填充位元
        if (err) break;
      }
      ts = stuffZone ? nextStart(ts) : te; n++;
    }
    const tEnd = got.errflag !== undefined ? got.errflag + 6 * T : ts;
    if (err){ A(err.t0, err.t1, 'fields', err.kind, err.label, '!', {}); errs++; from = tEnd + T; continue; }
    // 欄位標示
    for (const fd of fields){
      let label = CAN_FIELD[fd.f], short = CAN_FIELD[fd.f], kind = 'c' + fd.f, d = {};
      if (fd.f === 'id'){ label = `ID 0x${got.id.toString(16).toUpperCase().padStart(3, '0')}`; short = got.id.toString(16).toUpperCase(); d = { id:got.id }; }
      if (fd.f === 'dlc'){ label = `DLC ${got.dlc}`; short = String(got.dlc); d = { dlc:got.dlc }; }
      if (fd.f === 'rtr'){ label = got.rtr ? 'RTR=1 遠端' : 'RTR=0 資料'; short = 'R'; }
      if (fd.f === 'ide'){ label = 'IDE=0 標準'; short = 'I'; }
      if (fd.f === 'crc'){ label = `CRC 0x${got.crc.toString(16).toUpperCase().padStart(4, '0')}`; short = 'CRC'; }
      if (fd.f === 'ack'){ const ok = got.ackBit === 0; label = ok ? 'ACK（有節點確認）' : 'ACK 錯誤（沒人確認）'; short = ok ? 'A' : 'N'; kind = ok ? 'cack' : 'cnack'; }
      if (fd.f === 'data'){
        got.data.forEach((v, k) => A(fd.t0 + (fd.t1 - fd.t0) * k / got.data.length, fd.t0 + (fd.t1 - fd.t0) * (k + 1) / got.data.length, 'fields', 'cdata', `D${k} 0x${hex2(v)}`, hex2(v), { value:v, index:k }));
        continue;
      }
      A(fd.t0, fd.t1, 'fields', kind, label, short, d);
    }
    const calc = crc15(raw.slice(0, raw.length - 15 - 2 - (got.errflag !== undefined ? 0 : 8)));
    const crcOk = calc === got.crc, ackOk = got.ackBit === 0;
    A(tSof, tEnd, 'packets', !crcOk ? 'ccrcerr' : ackOk ? 'cframe' : 'cframenack', `ID 0x${got.id.toString(16).toUpperCase().padStart(3, '0')} · ${got.data.length} 位元組 · ${got.data.map(hex2).join(' ') || '（無資料）'}${crcOk ? '' : ' · CRC 錯誤'}${ackOk ? '' : ' · 沒有 ACK'}`, `0x${got.id.toString(16).toUpperCase()}`,
      { id:got.id, data:got.data, crc:got.crc, calc, crcOk, ackOk, stuffBits:anns.filter(a => a.kind === 'cstuff' && a.t0 >= tSof && a.t1 <= tEnd).length });
    frames++;
    // 沒有 ACK 時，傳送端從 ACK 分隔位元的位置開始送出錯誤旗標（6 個顯性位元）
    if (got.errflag !== undefined){ A(got.errflag, got.errflag + 6 * T, 'fields', 'cerrflag', '錯誤旗標（6 個顯性位元）', 'ERR'); from = got.errflag + 14 * T; continue; }
    from = tEnd + 2 * T;
  }
  const mp = minPulse(bus);
  return { anns, stats:{ frames, errors:errs, estRate: mp < Infinity ? 1e6 / mp : 0 } };
}
