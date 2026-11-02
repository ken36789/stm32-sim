// 外接模組的 3D 模型與狀態顯示
import * as THREE from 'three';
import { MODULE_TYPES, variantOf } from '../core/parts.js';
import { moduleLabel } from '../core/sim.js';
import { G, M, box, cyl, topPlane, ctex, hitBox, hitTarget, glowSprite, addPin, MOD_PIN_TOP } from './scene.js';

const hex = n => '#' + n.toString(16).padStart(6, '0');

const PROTO_ART = { i2c:'I2C', uart:'UART', spi:'SPI', can:'CAN' };
function drawTop(m, T, v){
  const S = 20, W = T.w * S, H = T.d * S, pitch = T.pitch || 5;
  return ctex(W, H, g => {
    g.fillStyle = hex(T.pcb); g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 3; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#eef2f4'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 24px "JetBrains Mono", monospace';
    T.pins.forEach(([n], j) => g.fillText(n, 5.3 * S, (T.d / 2 + (j - (T.pins.length - 1) / 2) * pitch) * S));
    g.textAlign = 'right'; g.font = '600 21px "Chakra Petch", "Noto Sans TC", sans-serif';
    g.fillText(moduleLabel(m), W - 14, 24);
    g.font = '500 16px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(238,242,244,.75)';
    const part = v.part.length > 22 ? v.part.slice(0, 21) + '…' : v.part;
    g.fillText(part, W - 14, H - 18);
  });
}

/** 分析儀的小螢幕：畫出協定名稱和代表性的波形 */
function drawScreen(proto){
  return ctex(320, 200, g => {
    g.fillStyle = '#071014'; g.fillRect(0, 0, 320, 200);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; for (let x = 0; x < 320; x += 32){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 200); g.stroke(); }
    g.fillStyle = '#ffd666'; g.font = '700 30px "JetBrains Mono", monospace'; g.textBaseline = 'top'; g.fillText(PROTO_ART[proto], 14, 10);
    const wave = (y, bits, color) => { g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); let lv = bits[0]; g.moveTo(10, y - lv * 28); bits.forEach((b, i) => { const x = 10 + i * 300 / bits.length; g.lineTo(x, y - lv * 28); g.lineTo(x, y - b * 28); lv = b; }); g.lineTo(310, y - lv * 28); g.stroke(); };
    const P = { i2c:[[1,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1], [1,0,0,1,1,1,0,0,1,1,0,0,0,1,1,0,1]], uart:[[1,1,0,1,0,0,1,0,1,1,0,1,1,0,0,1,1], [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]], spi:[[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], [0,1,1,0,0,1,0,0,1,1,1,0,1,0,0,1,0]], can:[[1,1,0,0,1,0,1,1,1,0,0,0,0,1,0,1,1], [0,0,1,1,0,1,0,0,0,1,1,1,1,0,1,0,0]] }[proto];
    wave(96, P[0], proto === 'can' ? '#ff9f43' : '#5fe08a'); wave(170, P[1], proto === 'can' ? '#5aa8ff' : '#7fc2f2');
  });
}

export function buildModule(m, [sx, sz], parent){
  const T = MODULE_TYPES[m.type], v = variantOf(m.type, m.variant), pitch = T.pitch || 5;
  const grp = new THREE.Group(); grp.position.set(sx, -3, sz); parent.add(grp);
  box(T.w, 1.6, T.d, M(T.pcb, { roughness:.7 }), 0, -.8, 0, grp);
  topPlane(T.w, T.d, drawTop(m, T, v), 0, .01, 0, grp);
  for (const [x, z] of [[-T.w / 2 + 2, -T.d / 2 + 2], [T.w / 2 - 2, -T.d / 2 + 2], [-T.w / 2 + 2, T.d / 2 - 2], [T.w / 2 - 2, T.d / 2 - 2]]) cyl(.9, 2.4, M(0x2a2d31), x, -2.8, z, grp, 6);
  box(3, 2.5, T.pins.length * pitch, M(0x16181b), -T.w / 2 + 3, 1.25, 0, grp);
  T.pins.forEach(([n], j) => addPin(`${m.id}.${n}`, sx - T.w / 2 + 3, MOD_PIN_TOP, sz + (j - (T.pins.length - 1) / 2) * pitch));
  hitBox(T.w - 6, 1.6, T.d, sx + 3, -2.2, sz, { type:'module', id:m.id }, parent);
  const V = { type:m.type };
  const cx = T.w / 2 - 6, wx = sx + cx;   // 主要元件位置（模組右半部）
  switch (m.type){
    case 'led': {
      V.mat = M(v.color, { transparent:true, opacity:.88, roughness:.2, emissive:0x000000 });
      cyl(2.6, .6, V.mat, cx, .3, -1, grp, 28); cyl(2.4, 4.2, V.mat, cx, 2.7, -1, grp, 28);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), V.mat); dome.position.set(cx, 4.8, -1); grp.add(dome);
      V.glow = glowSprite(v.color, 22); V.glow.position.set(wx, 3, sz - 1); parent.add(V.glow); V.color = v.color;
      box(4, 1.1, 1.1, M(0xd9c6a0), cx - 2, .6, 4.2, grp);
      hitTarget(4, wx, 0, sz - 1, { type:'module', id:m.id }, parent);
      break;
    }
    case 'rgb': {
      V.mat = M(0xf2f2f2, { transparent:true, opacity:.9, roughness:.25, emissive:0x000000 });
      cyl(2.6, 4.2, V.mat, cx, 2.1, 0, grp, 28);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), V.mat); dome.position.set(cx, 4.2, 0); grp.add(dome);
      V.glow = glowSprite(0xffffff, 24); V.glow.position.set(wx, 3, sz); parent.add(V.glow);
      hitTarget(4, wx, 0, sz, { type:'module', id:m.id }, parent);
      break;
    }
    case 'button': {
      if (v.kind === 'touch'){
        cyl(4.2, .3, M(0xc9a24f, { metalness:.5, roughness:.35 }), cx - 1, .15, -1, grp, 32);
        const pad = cyl(3.4, .5, M(0x2e6b4f, { roughness:.5 }), cx - 1, .55, -1, grp, 32);
        G.caps[m.id] = { mesh:pad, y:.55 };
      } else {
        box(6, 1.8, 6, M(0x2b2e33, { metalness:.4, roughness:.4 }), cx - 1, .9, -1.5, grp);
        const cap = cyl(1.9, 1.8, M(0x1e2024, { roughness:.5 }), cx - 1, 2.7, -1.5, grp);
        G.caps[m.id] = { mesh:cap, y:2.7 };
      }
      hitTarget(4.2, wx - 1, 0, sz - 1.5, { type:'press', which:m.id }, parent);
      break;
    }
    case 'pir': {
      cyl(5.6, 1.2, M(0xe8e6df), cx - 2, .6, 0, grp, 32);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M(0xf4f2ea, { roughness:.9 }));
      dome.scale.y = v.id === 'pir-am312' ? .6 : .85; dome.position.set(cx - 2, 1.2, 0); dome.castShadow = true; grp.add(dome);
      V.glow = glowSprite(0xff3b30, 8); V.glow.position.set(wx + 3.5, -1.5, sz + 6.5); parent.add(V.glow);
      hitTarget(5.6, wx - 2, -.5, sz, { type:'touch', id:m.id }, parent);
      break;
    }
    case 'pot': {
      if (v.kind === 'slide'){
        box(2.4, .6, 14, M(0x1c1d20), cx - 1, .3, 0, grp);
        V.knob = box(4, 2.6, 3, M(0xe6e6e6, { roughness:.4 }), cx - 1, 1.6, 0, grp); V.slide = true;
      } else if (v.kind === 'ldr'){
        cyl(2.6, .9, M(0xf0e1b8, { roughness:.5 }), cx - 1, .45, 0, grp, 28);
        topPlane(4.4, 4.4, ctex(128, 128, c => { c.fillStyle = '#f0e1b8'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.strokeStyle = '#c23a20'; c.lineWidth = 8; c.beginPath(); for (let i = 0; i < 7; i++){ const y = 22 + i * 14; c.moveTo(24, y); c.lineTo(104, y); } c.stroke(); }), cx - 1, .92, 0, grp);
      } else {
        box(9, 4, 9, M(0x2f5fb3, { roughness:.5 }), cx - 1, 2, 0, grp);
        cyl(1.6, 3, M(0xbfc5ca, { metalness:.6, roughness:.3 }), cx - 1, 5.2, 0, grp);
        V.knob = new THREE.Group(); V.knob.position.set(cx - 1, 6.8, 0); grp.add(V.knob);
        cyl(3.2, 2.6, M(0x1e2024, { roughness:.55 }), 0, 0, 0, V.knob, 28);
        box(.7, .4, 2.6, M(0xffffff), 0, 1.4, -1.4, V.knob);
      }
      hitTarget(5, wx - 1, 0, sz, { type:'module', id:m.id }, parent);
      break;
    }
    case 'temp': {
      const metal = v.dev === 'bmx280';
      V.chip = box(metal ? 3.2 : 2.6, metal ? 1.1 : .9, metal ? 3.2 : 2.6, M(metal ? 0xcdd2d6 : 0x1c1e21, metal ? { metalness:.65, roughness:.28 } : {}), cx - 1, .5, -3, grp);
      V.chipColor = metal ? 0xcdd2d6 : 0x1c1e21;
      box(1.6, .7, .9, M(0xb48a5a), cx - 4, .35, 4, grp); box(1.6, .7, .9, M(0xb48a5a), cx - 1, .35, 4, grp); box(2.4, .9, 1.6, M(0x1b1b1b), cx + 2, .45, 4, grp);
      hitTarget(4.2, wx - 1, -1.6, sz - 3, { type:'touch', id:m.id }, parent);
      setDamaged(V, m.st.damaged);
      break;
    }
    case 'buzzer': {
      cyl(5.2, 5.6, M(0x161719, { roughness:.6 }), cx - 1, 2.8, 0, grp, 32);
      cyl(1, .2, M(0x4a4d52), cx - 1, 5.7, 0, grp, 16);
      V.glow = glowSprite(0xffd27a, 18); V.glow.position.set(wx - 1, 4, sz); parent.add(V.glow);
      hitTarget(5, wx - 1, 0, sz, { type:'module', id:m.id }, parent);
      break;
    }
    case 'relay': {
      const ssr = v.id === 'relay-ssr';
      box(ssr ? 9 : 10, ssr ? 5 : 8, ssr ? 6 : 8, M(ssr ? 0x1b1c1f : 0x2756b8, { roughness:.5 }), cx - 2, ssr ? 2.5 : 4, -2, grp);
      box(5, 4, 9, M(0x2c7a43, { roughness:.6 }), cx + 4.5, 2, 3.5, grp);
      V.glow = glowSprite(0xff3b30, 8); V.glow.position.set(wx - 7, -1.5, sz + 6.5); parent.add(V.glow);
      hitTarget(6, wx - 1, 0, sz, { type:'module', id:m.id }, parent);
      break;
    }
    case 'tc': {
      box(3.2, 1, 5, M(0x1c1e21), cx - 3, .5, -4, grp);                                        // SOIC-8：MAX6675／MAX31855
      box(6, 4.2, 5, M(0xf2d24a, { roughness:.5 }), cx + 1, 2.1, 6, grp);                      // K 型熱電偶接頭（黃色）
      const probe = new THREE.CatmullRomCurve3([new THREE.Vector3(wx + 1, 2, sz + 9), new THREE.Vector3(wx + 3, 1, sz + 16), new THREE.Vector3(wx + 8, -5.5, sz + 22), new THREE.Vector3(wx + 16, -5.8, sz + 20)]);
      const pm = new THREE.Mesh(new THREE.TubeGeometry(probe, 30, .55, 8, false), M(0x6b5a2a, { roughness:.6 })); pm.castShadow = true; parent.add(pm);
      V.glow = glowSprite(0xff7a2a, 10); V.glow.position.set(wx + 16, -4.5, sz + 20); parent.add(V.glow);
      hitTarget(5, wx - 1, 0, sz - 2, { type:'module', id:m.id }, parent);
      break;
    }
    case 'flash': {
      V.chip = box(4.4, 1.1, 5.4, M(0x1c1e21), cx - 1, .55, -1, grp);
      topPlane(4.2, 5.2, ctex(128, 160, g => { g.fillStyle = '#1c1e21'; g.fillRect(0, 0, 128, 160); g.fillStyle = '#c6ccd1'; g.font = '600 22px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillText('W25Q', 64, 62); g.fillText(v.id === 'w25q128' ? '128JV' : '32JV', 64, 92); g.beginPath(); g.arc(18, 140, 7, 0, 7); g.fillStyle = '#121417'; g.fill(); }), cx - 1, 1.11, -1, grp);
      for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) box(1, .3, .5, M(0xbfc5ca, { metalness:.6 }), cx - 1 + sd * 2.6, .2, -1 - 1.9 + k * 1.27, grp);
      hitTarget(5, wx - 1, 0, sz - 1, { type:'module', id:m.id }, parent);
      break;
    }
    case 'can': {
      box(3.6, 1, 5, M(0x1c1e21), cx - 3, .5, -5, grp);                                        // 收發器 SOIC-8
      box(7, 5, 8, M(0x2c7a43, { roughness:.6 }), cx + 1, 2.5, 6, grp);                        // 綠色端子台（CANH／CANL）
      box(3, .8, 1.2, M(0x1b1b1b), cx - 3, .4, 1, grp);                                        // 120 Ω 終端電阻
      V.glow = glowSprite(0x3ddc84, 8); V.glow.position.set(wx - 6, 1.5, sz - 10); parent.add(V.glow);
      hitTarget(6, wx - 1, 0, sz, { type:'module', id:m.id }, parent);
      break;
    }
    case 'stepper': {
      // TB67S128FTG 驅動板（QFN 晶片、DMODE 指撥開關）＋ 直立的 NEMA 步進馬達，軸上裝負載（圓盤／飛輪）
      const mx = 5.6, mz = -6.6, big = v.id === 'nema23', S = big ? 11.6 : 10.6;
      box(4.6, .8, 4.6, M(0x1c1e21, { roughness:.5 }), 2.6, .4, 5.2, grp);
      topPlane(4.4, 4.4, ctex(128, 128, g => { g.fillStyle = '#1c1e21'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#c6ccd1'; g.font = '600 19px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillText('TB67S', 64, 54); g.fillText('128FTG', 64, 80); g.beginPath(); g.arc(16, 112, 6, 0, 7); g.fillStyle = '#121417'; g.fill(); }), 2.6, .81, 5.2, grp);
      box(3.6, 1, 5.2, M(0xc0392b, { roughness:.5 }), 8.6, .5, 5.2, grp);                       // DMODE 指撥開關（紅色）
      V.dip = [0, 1, 2].map(k => box(1, .55, 1.1, M(0xf2f2f2), 8.6, 1.1, 3.6 + k * 1.6, grp));
      ['#d63031', '#2d3436', '#0984e3', '#00b894'].forEach((c, k) => box(.45, .35, 5.6, M(parseInt(c.slice(1), 16), { roughness:.6 }), 1.4 + k * .8, .2, -1.4, grp));   // 線圈 A+ A− B+ B−
      const al = M(0xb8bec4, { metalness:.7, roughness:.3 });
      box(S, 1.6, S, al, mx, .8, mz, grp); box(S - .4, 5.6, S - .4, M(0x1f2226, { roughness:.55, metalness:.25 }), mx, 4.4, mz, grp); box(S, 1.6, S, al, mx, 8, mz, grp);
      cyl(2.2, .6, al, mx, 9.1, mz, grp, 24); cyl(.55, 2.4, M(0xd9dde0, { metalness:.8, roughness:.2 }), mx, 10.2, mz, grp, 16);
      V.rotor = new THREE.Group(); V.rotor.position.set(mx, 11, mz); grp.add(V.rotor);
      const accent = M(0xffd166, { emissive:0x332200 });
      const hub = new THREE.Group(); cyl(1.4, 1.2, M(0x2a2d31), 0, 0, 0, hub, 16); box(.7, .5, 3.6, accent, 0, .6, -1.6, hub);
      const disk = new THREE.Group(); cyl(4.6, .6, M(0xc7ccd1, { metalness:.75, roughness:.28 }), 0, 0, 0, disk, 40); box(.9, .2, 4.2, accent, 0, .4, -2.3, disk); for (let k = 0; k < 4; k++){ const a = k * Math.PI / 2 + Math.PI / 4; cyl(.55, .7, M(0x1a1c1f), Math.cos(a) * 2.6, .05, Math.sin(a) * 2.6, disk, 12); }
      const fly = new THREE.Group(); cyl(6.6, 1.8, M(0x8f969c, { metalness:.8, roughness:.3 }), 0, .4, 0, fly, 48); cyl(4.6, 1.9, M(0x5d646a, { metalness:.7, roughness:.35 }), 0, .45, 0, fly, 40); box(1.1, .25, 6, accent, 0, 1.45, -3.2, fly);
      V.loads = [hub, disk, fly]; V.loads.forEach(g => V.rotor.add(g));
      V.glow = glowSprite(0xff3b30, 26); V.glow.position.set(sx + mx, 6, sz + mz); parent.add(V.glow);
      V.en = glowSprite(0x3ddc84, 6); V.en.position.set(sx + 5.6, -1.8, sz + 9.4); parent.add(V.en);
      hitBox(S + 2, 14, S + 2, sx + mx, 3, sz + mz, { type:'module', id:m.id }, parent);
      break;
    }
    case 'la_i2c': case 'la_uart': case 'la_spi': case 'la_can': {
      // 小型邏輯分析儀：外殼、螢幕、USB 線與活動指示燈
      box(13, 6, T.d - 6, M(0x23272c, { roughness:.45, metalness:.2 }), cx - 2, 3, 0, grp);
      topPlane(11, (T.d - 6) * .62, drawScreen(T.analyzer), cx - 2, 6.02, -1.5, grp);
      const usb = new THREE.CatmullRomCurve3([new THREE.Vector3(wx + 4.5, 3, sz + T.d / 2 - 4), new THREE.Vector3(wx + 8, 1, sz + T.d / 2 + 2), new THREE.Vector3(wx + 14, -5.6, sz + T.d / 2 + 4)]);
      const um = new THREE.Mesh(new THREE.TubeGeometry(usb, 20, .9, 8, false), M(0x2b2f33, { roughness:.5 })); um.castShadow = true; parent.add(um);
      V.led = M(0x2a3a2e, { emissive:0x000000 }); box(1.2, .5, 1.2, V.led, cx + 3, 6.1, T.d / 2 - 5.5, grp);
      V.glow = glowSprite(0x5fe08a, 9); V.glow.position.set(wx + 3, 7.4, sz + T.d / 2 - 5.5); parent.add(V.glow);
      hitBox(14, 8, T.d - 4, wx - 2, 3, sz, { type:'module', id:m.id }, parent);
      break;
    }
  }
  G.mods[m.id] = V;
}

function setDamaged(V, d){ if (V.chip) V.chip.material.color.setHex(d ? 0x3a2b22 : V.chipColor); }
const lit = (V, on, color) => { if (V.mat){ V.mat.emissive.setHex(on ? color : 0); V.mat.emissiveIntensity = on ? 1.6 : 0; } if (V.glow){ V.glow.visible = on; if (on) V.glow.material.color.setHex(color); } };

/** 依模擬結果更新模組外觀；t 為動畫時間（毫秒） */
export function updateModule(m, s, t){
  const V = G.mods[m.id]; if (!V) return;
  switch (m.type){
    case 'led': lit(V, s.on, V.color); break;
    case 'rgb': { const c = (s.r ? 0xff2020 : 0) | (s.g ? 0x20ff40 : 0) | (s.b ? 0x3060ff : 0); lit(V, !!c, c); break; }
    case 'buzzer': V.glow.visible = s.on; if (s.on){ const k = 14 + 6 * ((t / 90) % 1); V.glow.scale.set(k, k, 1); } break;
    case 'relay': V.glow.visible = s.on; break;
    case 'pir': V.glow.visible = s.active; break;
    case 'pot': if (V.knob){ if (V.slide) V.knob.position.z = (s.value - .5) * 11; else V.knob.rotation.y = -(s.value - .5) * Math.PI * 1.6; } break;
    case 'temp': setDamaged(V, s.damaged); break;
    case 'la_i2c': case 'la_uart': case 'la_spi': case 'la_can': {
      const on = !!s.active; V.glow.visible = on; V.led.emissive.setHex(on ? 0x3ddc84 : 0); V.led.emissiveIntensity = on ? 1.5 : 0; break;
    }
    case 'can': V.glow.visible = !!s.on; break;
    case 'tc': V.glow.visible = (m.st.tcT ?? 0) > 60; break;
    case 'stepper': {
      V.rotor.rotation.y = -s.deg * Math.PI / 180;                 // 從軸端往下看，順時針為正
      V.loads.forEach((g, k) => { g.visible = k === s.load; });
      const bits = s.bits || '000'; V.dip.forEach((d, k) => { d.position.x = 8.6 + (bits[k] === '1' ? .9 : -.9); });
      V.glow.visible = !!s.stalled; if (s.stalled) V.glow.material.opacity = .55 + .45 * Math.sin(t / 70);
      V.en.visible = !!s.en; break;
    }
  }
}
