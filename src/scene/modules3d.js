// 外接模組的 3D 模型與狀態顯示
import * as THREE from 'three';
import { MODULE_TYPES, variantOf } from '../core/parts.js';
import { moduleLabel } from '../core/sim.js';
import { G, M, box, cyl, topPlane, ctex, hitBox, hitTarget, glowSprite, addPin, MOD_PIN_TOP } from './scene.js';

const hex = n => '#' + n.toString(16).padStart(6, '0');

function drawTop(m, T, v){
  const S = 20, W = T.w * S, H = T.d * S;
  return ctex(W, H, g => {
    g.fillStyle = hex(T.pcb); g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 3; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#eef2f4'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 24px "JetBrains Mono", monospace';
    T.pins.forEach(([n], j) => g.fillText(n, 5.3 * S, (T.d / 2 + (j - (T.pins.length - 1) / 2) * 5) * S));
    g.textAlign = 'right'; g.font = '600 21px "Chakra Petch", "Noto Sans TC", sans-serif';
    g.fillText(moduleLabel(m), W - 14, 24);
    g.font = '500 16px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(238,242,244,.75)';
    const part = v.part.length > 22 ? v.part.slice(0, 21) + '…' : v.part;
    g.fillText(part, W - 14, H - 18);
  });
}

export function buildModule(m, [sx, sz], parent){
  const T = MODULE_TYPES[m.type], v = variantOf(m.type, m.variant);
  const grp = new THREE.Group(); grp.position.set(sx, -3, sz); parent.add(grp);
  box(T.w, 1.6, T.d, M(T.pcb, { roughness:.7 }), 0, -.8, 0, grp);
  topPlane(T.w, T.d, drawTop(m, T, v), 0, .01, 0, grp);
  for (const [x, z] of [[-T.w / 2 + 2, -T.d / 2 + 2], [T.w / 2 - 2, -T.d / 2 + 2], [-T.w / 2 + 2, T.d / 2 - 2], [T.w / 2 - 2, T.d / 2 - 2]]) cyl(.9, 2.4, M(0x2a2d31), x, -2.8, z, grp, 6);
  box(3, 2.5, T.pins.length * 5, M(0x16181b), -T.w / 2 + 3, 1.25, 0, grp);
  T.pins.forEach(([n], j) => addPin(`${m.id}.${n}`, sx - T.w / 2 + 3, MOD_PIN_TOP, sz + (j - (T.pins.length - 1) / 2) * 5));
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
  }
}
