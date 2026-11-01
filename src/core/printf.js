// C printf 格式化（%d %u %x %X %f %e %g %c %s %p，含寬度、精度與旗標）
/* ================= printf ================= */
export function cfmt(f, args){
  let i = 0; const str = v => v && v.__str !== undefined ? v.__str : String(v);
  return str(f).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z)?([diuxXfFeEgcsp%])/g, (x, flags, width, prec, conv) => {
    if (conv === '%') return '%';
    let v = args[i++], s;
    switch (conv){
      case 'd': case 'i': s = String(Math.trunc(Number(v) || 0)); break;
      case 'u': s = String((Math.trunc(Number(v) || 0)) >>> 0); break;
      case 'x': s = ((Number(v) || 0) >>> 0).toString(16); break;
      case 'X': s = ((Number(v) || 0) >>> 0).toString(16).toUpperCase(); break;
      case 'f': case 'F': s = (Number(v) || 0).toFixed(prec === undefined ? 6 : +prec); break;
      case 'e': case 'E': s = (Number(v) || 0).toExponential(prec === undefined ? 6 : +prec); if (conv === 'E') s = s.toUpperCase(); break;
      case 'g': s = String(+(Number(v) || 0).toPrecision(prec ? +prec : 6)); break;
      case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : String(v)[0] || ''; break;
      case 's': s = str(v); if (prec !== undefined) s = s.slice(0, +prec); break;
      case 'p': s = '0x2400' + ((Number(v) || 0x1a0) >>> 0).toString(16).padStart(4, '0'); break;
    }
    if (flags.includes('+') && /[dif]/.test(conv) && !s.startsWith('-')) s = '+' + s;
    if (width){
      const w = +width;
      if (flags.includes('-')) s = s.padEnd(w);
      else if (flags.includes('0') && /[diuxXfF]/.test(conv)) s = s[0] === '-' || s[0] === '+' ? s[0] + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0');
      else s = s.padStart(w);
    }
    return s;
  });
}
