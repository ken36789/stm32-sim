// 3D 場景：工作墊、開發板（依板型動態產生）、電源軌、外接模組、杜邦線
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FORMS } from '../core/boards.js';
import { RAIL_HOLES } from '../core/parts.js';
import { bench, wires } from '../core/sim.js';
import { WIRE_COLORS, mulberry32 } from './util.js';
import { buildModule } from './modules3d.js';

export const DESK_Y = -7, PIN_TOP_BOARD = 8.5, MOD_PIN_TOP = 5.5, RAIL_TOP = -1.2;
// 12 個模組位置：3 欄 × 4 列（第 3 欄在需要時才會用到）
export const SLOTS = [[40, -45], [68, -45], [40, -15], [68, -15], [40, 15], [68, 15], [40, 45], [68, 45], [96, -45], [96, -15], [96, 15], [96, 45]];
/** 模組中心：兩格大的模組（驅動板）放在兩格中間 */
export const slotPos = m => m.slot2 === undefined ? SLOTS[m.slot] : [(SLOTS[m.slot][0] + SLOTS[m.slot2][0]) / 2, (SLOTS[m.slot][1] + SLOTS[m.slot2][1]) / 2];
export const R = {};
export const G = { pins:{}, leds:{}, caps:{}, mods:{}, hit:[], wireHit:[], groups:{}, glowTex:null, usb:null, ready:false };
let stageEl = null;

/* ---------- 共用建構函式 ---------- */
export function ctex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = Math.min(8, R.renderer.capabilities.getMaxAnisotropy());
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const M = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness:.6, metalness:.05 }, o));
export function box(w, h, d, mat, x, y, z, parent){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
export function cyl(r, h, mat, x, y, z, parent, seg = 24){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
export function topPlane(w, d, tex, x, y, z, parent){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map:tex, roughness:.75, metalness:.05 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m;
}
const hitMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false });
export function hitBox(w, h, d, x, y, z, data, parent){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat); m.position.set(x, y, z); m.userData = data; parent.add(m); G.hit.push(m); return m;
}
export function hitTarget(r, x, y, z, data, parent){
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hitMat); m.position.set(x, y, z); m.userData = data; parent.add(m); G.hit.push(m); return m;
}
export function glowSprite(color, size){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:G.glowTex, color, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); s.visible = false; return s;
}
const ringGeo = new THREE.TorusGeometry(1.75, .3, 8, 28), pinGeo = new THREE.BoxGeometry(.9, 9.2, .9);
export const gold = new THREE.MeshStandardMaterial({ color:0xd6ac4e, metalness:.55, roughness:.32 });
/** 腳位：金色排針、選取光環與點擊範圍（座標為世界座標） */
export function addPin(id, x, top, z, withPin = true){
  if (withPin){ const p = new THREE.Mesh(pinGeo, gold); p.position.set(x, top - 4.6, z); p.castShadow = true; G.groups.markers.add(p); }
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color:0xffffff, depthTest:false, transparent:true }));
  ring.rotation.x = Math.PI / 2; ring.position.set(x, top + .4, z); ring.visible = false; ring.renderOrder = 5; G.groups.markers.add(ring);
  hitTarget(2.4, x, top - .6, z, { type:'pin', id }, G.groups.markers);
  G.pins[id] = { ring, top:new THREE.Vector3(x, top, z) };
}
function disposeGroup(key){
  const g = G.groups[key]; if (!g) return;
  R.scene.remove(g);
  g.traverse(o => {
    if (o.geometry && o.geometry !== ringGeo && o.geometry !== pinGeo) o.geometry.dispose();
    if (o.material && o.material !== hitMat && o.material !== gold){ if (o.material.map && o.material.map !== G.glowTex) o.material.map.dispose(); o.material.dispose(); }
  });
  G.groups[key] = null;
}
const newGroup = key => { disposeGroup(key); const g = new THREE.Group(); G.groups[key] = g; R.scene.add(g); return g; };

/* ---------- 初始化 ---------- */
export function sceneBg(){ return getComputedStyle(document.documentElement).getPropertyValue('--scene').trim() || '#c9d3d9'; }
export function initScene(stage){
  stageEl = stage;
  R.renderer = new THREE.WebGLRenderer({ antialias:true });
  R.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  R.renderer.shadowMap.enabled = true; R.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.insertBefore(R.renderer.domElement, stage.firstChild);
  R.scene = new THREE.Scene(); R.scene.background = new THREE.Color(sceneBg());
  R.camera = new THREE.PerspectiveCamera(36, 1, 1, 3000);
  R.controls = new OrbitControls(R.camera, R.renderer.domElement);
  R.controls.enableDamping = true; R.controls.dampingFactor = .09;
  R.controls.maxPolarAngle = Math.PI * .47; R.controls.minDistance = 40; R.controls.maxDistance = 700;
  R.scene.add(new THREE.HemisphereLight(0xffffff, 0x3d4c55, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(40, 160, 90); sun.castShadow = true;
  const coarse = matchMedia('(pointer:coarse)').matches; sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left:-150, right:150, top:110, bottom:-110, near:10, far:500 }); sun.shadow.bias = -.0008; sun.shadow.camera.updateProjectionMatrix();
  R.scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbfd6ff, .8); fill.position.set(-80, 60, -60); R.scene.add(fill);
  G.glowTex = ctex(128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(380, 260), new THREE.MeshStandardMaterial({ map:ctex(1520, 1040, drawMat), roughness:.95 }));
  mat.rotation.x = -Math.PI / 2; mat.position.set(-5, DESK_Y, 0); mat.receiveShadow = true; R.scene.add(mat);
  G.wires = new THREE.Group(); R.scene.add(G.wires);
  buildBench(); resize();
  new ResizeObserver(resize).observe(stage);
  G.ready = true;
}
function drawMat(g, W, H){
  g.fillStyle = '#4c6a77'; g.fillRect(0, 0, W, H);
  const S = W / 380;
  for (let x = 0; x <= 380; x += 10){ g.strokeStyle = x % 50 ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.16)'; g.lineWidth = x % 50 ? 1 : 2; g.beginPath(); g.moveTo(x * S, 0); g.lineTo(x * S, H); g.stroke(); }
  for (let z = 0; z <= 260; z += 10){ g.strokeStyle = z % 50 ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.16)'; g.lineWidth = z % 50 ? 1 : 2; g.beginPath(); g.moveTo(0, z * S); g.lineTo(W, z * S); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '600 13px "JetBrains Mono", monospace'; g.textBaseline = 'top';
  for (let x = 0; x <= 380; x += 50) g.fillText(String(x / 10) + (x === 350 ? ' cm' : ''), x * S + 4, 4);
  g.fillText('ESD SAFE · 防靜電工作墊', 8, H - 20);
}

/* ---------- 重建整個工作台 ---------- */
export function buildBench(){
  for (const k of ['board', 'rail', 'mods', 'markers']) disposeGroup(k);
  G.hit = []; G.pins = {}; G.leds = {}; G.caps = {}; G.mods = {};
  newGroup('markers');
  buildBoard(bench.board);
  buildRail();
  const mg = newGroup('mods');
  for (const m of bench.modules) buildModule(m, slotPos(m), mg);
  rebuildWires();
  R.scene.updateMatrixWorld(true);
}

/** 依封裝推算晶片大小與每邊接腳數（QFP 四邊有腳；SSOP 兩邊；QFN、BGA 沒有外露接腳） */
function pkgShape(pkg){
  const n = +(pkg.match(/\d+/) || [48])[0], qfp = /QFP/.test(pkg) && !/QFN/.test(pkg), ssop = /SSOP|TSSOP|SOP/.test(pkg);
  const size = n >= 176 ? 24 : n >= 128 ? 20 : n >= 100 ? 14 : n >= 64 ? 10 : n >= 44 ? 7 : n >= 30 ? 5.5 : 5;
  return [ssop ? size * .8 : size, qfp ? Math.min(44, Math.round(n / 4)) : 0, ssop ? Math.round(n / 2) : 0];
}
function boardLayout(b){
  const F = FORMS[b.form], W = F.w, D = Math.max(F.d, b.header.length / 2 * 5 + 26), x0 = -W, z0 = -D / 2, wide = W >= 70, [size, legs, sides] = pkgShape(b.pkg);
  return { F, W, D, x0, z0, wide, rows:b.header.length / 2,
    mcu:{ x:(x0 - 17) / 2, z: F.dbg ? (wide ? 8 : 6) : -6, size, legs, sides },
    usb:{ x:x0 + 12, z:z0 + 3.5 }, stlink:{ x: wide ? x0 + 28 : x0 + 12, z: wide ? z0 + 12 : z0 + 15 },
    pwr:{ x: wide ? x0 + 40 : x0 + 22, z:z0 + 6 }, sep: wide ? z0 + 25 : z0 + 23,
    ledZ:D / 2 - 16, btnZ:D / 2 - 7, ldo:{ x:x0 + 7, z: wide ? z0 + 18 : z0 + 30 } };
}
export const headerPos = (b, i) => { const rows = b.header.length / 2; return { x: i % 2 ? -9 : -14, z:(-(rows - 1) / 2 + Math.floor(i / 2)) * 5 }; };

function buildBoard(b){
  const g = newGroup('board'), L = boardLayout(b), { W, D, x0, z0 } = L, cx = -W / 2;
  box(W, 1.6, D, M(b.pcb, { roughness:.8 }), cx, -.8, 0, g);
  topPlane(W, D, ctex(Math.round(W * 14), Math.round(D * 14), (c, cw, ch) => drawBoard(c, cw, ch, b, L)), cx, .01, 0, g);
  const brass = M(0xc9a24f, { metalness:.5, roughness:.35 });
  for (const [x, z] of [[x0 + 3.5, z0 + 3.5], [x0 + 3.5, D / 2 - 3.5], [-3.5, z0 + 3.5], [-3.5, D / 2 - 3.5]]) cyl(1.5, 5.4, brass, x, DESK_Y + 2.7, z, g, 6);
  // 排針
  box(10, 2.5, L.rows * 5, M(0x16181b, { roughness:.7 }), -11.5, 1.25, 0, g);
  b.header.forEach((h, i) => { const p = headerPos(b, i); addPin(h.id, p.x, PIN_TOP_BOARD, p.z); });
  // MCU 與接腳
  const { x:mx, z:mz, size, legs, sides } = L.mcu;
  box(size, 1.4, size, M(0x1a1d21), mx, .7, mz, g);
  topPlane(size, size, ctex(512, 512, (c, w, h) => drawChip(c, w, h, b)), mx, 1.41, mz, g);
  if (legs){
    const lg = new THREE.BoxGeometry(.24, .25, 1.4), inst = new THREE.InstancedMesh(lg, M(0xbfc5ca, { metalness:.6, roughness:.3 }), legs * 4), o = new THREE.Object3D();
    const pitch = size * .86 / legs; let k = 0;
    for (let s = 0; s < 4; s++) for (let i = 0; i < legs; i++){
      const t = (i - (legs - 1) / 2) * pitch, e = size / 2 + .55;
      if (s < 2){ o.position.set(mx + t, .15, mz + (s ? e : -e)); o.rotation.set(0, 0, 0); } else { o.position.set(mx + (s === 2 ? -e : e), .15, mz + t); o.rotation.set(0, Math.PI / 2, 0); }
      o.updateMatrix(); inst.setMatrixAt(k++, o.matrix);
    }
    g.add(inst);
  } else if (sides){
    const per = Math.ceil(sides / 2), lg = new THREE.BoxGeometry(.3, .25, 1.4), inst = new THREE.InstancedMesh(lg, M(0xbfc5ca, { metalness:.6, roughness:.3 }), per * 2), o = new THREE.Object3D(); let k = 0;
    for (let s = 0; s < 2; s++) for (let i = 0; i < per; i++){ o.position.set(mx + (i - (per - 1) / 2) * size * .85 / per, .15, mz + (s ? 1 : -1) * (size / 2 + .55)); o.updateMatrix(); inst.setMatrixAt(k++, o.matrix); }
    g.add(inst);
  }
  hitBox(size + 2, 3, size + 2, mx, 1.2, mz, { type:'part', key:'mcu' }, g);
  // ST-LINK、USB、電源指示燈
  if (L.F.dbg){ box(7, 1.2, 7, M(0x1d2024), L.stlink.x, .6, L.stlink.z, g); hitBox(9, 3, 9, L.stlink.x, 1, L.stlink.z, { type:'part', key:'stlink' }, g); }
  box(5, 1.4, 2.6, M(0x23262a), L.ldo.x, .7, L.ldo.z, g); hitBox(7, 3, 5, L.ldo.x, 1, L.ldo.z, { type:'part', key:'ldo' }, g);
  box(4.6, 1.1, 2, M(0xcfd3d6, { metalness:.55, roughness:.3 }), mx + size / 2 + 6, .55, mz - size / 2 - 2, g);
  box(8, 3.2, 7, M(0xb9bec2, { metalness:.7, roughness:.25 }), L.usb.x, 1.6, L.usb.z, g);
  hitTarget(5, L.usb.x, 2, L.usb.z, { type:'usb' }, g);
  G.usb = new THREE.Group();
  box(7.5, 4.2, 9, M(0x2b2f33), L.usb.x, 1.8, z0 - 4.5, G.usb);
  const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(L.usb.x, 1.8, z0 - 9), new THREE.Vector3(L.usb.x - 4, 0, z0 - 26), new THREE.Vector3(L.usb.x - 20, DESK_Y + 1.2, z0 - 48), new THREE.Vector3(L.usb.x - 50, DESK_Y + 1.2, z0 - 80)]);
  const cm = new THREE.Mesh(new THREE.TubeGeometry(cable, 40, 1.3, 10, false), M(0x2b2f33, { roughness:.5 })); cm.castShadow = true; G.usb.add(cm);
  hitTarget(5, L.usb.x, 2, z0 - 5, { type:'usb' }, G.usb);
  g.add(G.usb);
  const led = (key, x, z, color) => {
    const mt = M(0xe8e2d6, { roughness:.35, emissive:0x000000 });
    box(1.8, .9, 1.1, mt, x, .45, z, g);
    const glow = glowSprite(color, 9); glow.position.set(x, 1.6, z); g.add(glow);
    G.leds[key] = { mt, glow, color, on:false, base:0xe8e2d6 };
  };
  led('PWR', L.pwr.x, L.pwr.z, 0xff3b30);
  if (L.F.dbg) led('COM', L.pwr.x + 4.5, L.pwr.z, 0xff3b30);
  b.leds.forEach((l, i) => led(l.name, x0 + 6 + i * 5, L.ledZ, l.hex));
  // 按鈕
  const button = (key, x, color) => {
    box(5, 1.6, 5, M(0xbfc4c8, { metalness:.6, roughness:.3 }), x, .8, L.btnZ, g);
    const cap = cyl(1.65, 1.5, M(color, { roughness:.45 }), x, 2.35, L.btnZ, g);
    G.caps[key] = { mesh:cap, y:2.35 };
    hitTarget(3.4, x, 2.6, L.btnZ, { type:'press', which:key }, g);
  };
  if (b.btn) button('B1', x0 + 8, 0x2459d6);
  button('RESET', b.btn ? x0 + 18 : x0 + 8, 0x1d1f22);
  // 裝飾用被動元件
  const rnd = mulberry32(b.id.length * 7), capM = M(0xb48a5a), resM = M(0x1b1b1b);
  for (let k = 0; k < Math.round(W * D / 160); k++){
    const x = x0 + 3 + rnd() * (W - 23), z = z0 + 6 + rnd() * (D - 12);
    if (Math.abs(x - mx) < size / 2 + 3 && Math.abs(z - mz) < size / 2 + 3) continue;
    if (z > L.ledZ - 3 || (z < L.sep && L.F.dbg)) continue;
    box(rnd() > .5 ? 1.6 : 1, .5, .8, rnd() > .45 ? capM : resM, x, .25, z, g).rotation.y = rnd() > .5 ? Math.PI / 2 : 0;
  }
}
function drawBoard(g, W, H, b, L){
  const S = 14, X = x => (x - L.x0) * S, Z = z => (z - L.z0) * S, F = L.F;
  g.fillStyle = '#' + b.pcb.toString(16).padStart(6, '0'); g.fillRect(0, 0, W, H);
  const rnd = mulberry32(b.id.length * 13); g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < W * H / 9000; k++){
    g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = k % 4 ? 3 : 5;
    let x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 3; s++){ const a = Math.floor(rnd() * 8) * Math.PI / 4, len = 40 + rnd() * 200; x += Math.cos(a) * len; y += Math.sin(a) * len; g.lineTo(x, y); }
    g.stroke();
  }
  for (const [x, z] of [[L.x0 + 3.5, L.z0 + 3.5], [L.x0 + 3.5, L.D / 2 - 3.5], [-3.5, L.z0 + 3.5], [-3.5, L.D / 2 - 3.5]]){
    g.fillStyle = '#b58a3a'; g.beginPath(); g.arc(X(x), Z(z), 24, 0, 7); g.fill(); g.fillStyle = '#0a0c0e'; g.beginPath(); g.arc(X(x), Z(z), 15, 0, 7); g.fill();
  }
  g.fillStyle = '#e6ebee'; g.strokeStyle = '#e6ebee';
  const txt = (s, x, z, size = 18, align = 'center', font = '"JetBrains Mono", monospace') => { g.font = `600 ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, X(x), Z(z)); };
  b.header.forEach((h, i) => { const p = headerPos(b, i); if (i % 2 === 0) txt(h.label, -16.6, p.z, 19, 'right'); else txt(h.label, -6.6, p.z, 19, 'left'); });
  const sz = L.mcu.size + 3; g.lineWidth = 2; g.strokeRect(X(L.mcu.x - sz / 2), Z(L.mcu.z - sz / 2), sz * S, sz * S);
  txt('U1', L.mcu.x - sz / 2, L.mcu.z - sz / 2 - 1.4, 15, 'left');
  if (F.dbg){
    g.setLineDash([10, 8]); g.beginPath(); g.moveTo(X(L.x0 + 2), Z(L.sep)); g.lineTo(X(-18), Z(L.sep)); g.stroke(); g.setLineDash([]);
    txt(b.prog, L.stlink.x, L.stlink.z + 5.8, 14);
    txt('PWR', L.pwr.x, L.pwr.z + 2.4, 12); txt('COM', L.pwr.x + 4.5, L.pwr.z + 2.4, 12);
  } else txt('PWR', L.pwr.x, L.pwr.z + 2.4, 12);
  txt('USB', L.usb.x + 6.5, L.usb.z, 13, 'left');
  b.leds.forEach((l, i) => txt(l.name, L.x0 + 6 + i * 5, L.ledZ + 2.6, 12));
  if (b.btn) txt(b.btn.name, L.x0 + 8, L.btnZ - 4, 12);
  txt('RESET', b.btn ? L.x0 + 18 : L.x0 + 8, L.btnZ - 4, 12);
  const name = b.name.replace(/（.*）/, ''), avail = (L.W - 22) * S;
  let fs = 26; g.font = `600 ${fs}px "Chakra Petch", sans-serif`; while (g.measureText(name).width > avail && fs > 12){ fs--; g.font = `600 ${fs}px "Chakra Petch", sans-serif`; }
  txt(name, L.x0 + 2.5, L.D / 2 - 2.2, fs, 'left', '"Chakra Petch", sans-serif');
}
function drawChip(g, W, H, b){
  g.fillStyle = '#1a1d21'; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(3); for (let k = 0; k < 900; k++){ g.fillStyle = `rgba(255,255,255,${rnd() * .025})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
  g.fillStyle = '#121417'; g.beginPath(); g.arc(56, 56, 22, 0, 7); g.fill();
  const cut = b.mcu.startsWith('STM32') ? 9 : b.mcu.startsWith('TMS320') ? 6 : Math.min(b.mcu.length, 10), l1 = b.mcu.slice(0, cut), l2 = b.mcu.slice(cut) || b.vendor;
  g.fillStyle = '#c6ccd1'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${l1.length > 9 ? 58 : 66}px "JetBrains Mono", monospace`; g.fillText(l1, W / 2, H / 2 - 52);
  g.font = `600 ${l2.length > 8 ? 46 : 56}px "JetBrains Mono", monospace`; g.fillText(l2, W / 2, H / 2 + 16);
  g.font = '400 32px "JetBrains Mono", monospace'; g.fillStyle = '#9aa2a8'; g.fillText(`${b.core}  ${b.mhz}MHz`, W / 2, H / 2 + 82);
}

/* ---------- 電源軌（麵包板條） ---------- */
function buildRail(){
  const g = newGroup('rail'), len = RAIL_HOLES * 10 + 6;
  box(12, 4.6, len, M(0xeceeea, { roughness:.85 }), 16, DESK_Y + 2.3, 0, g);
  topPlane(12, len, ctex(240, len * 20, (c, w, h) => {
    c.fillStyle = '#eceeea'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d6372d'; c.fillRect(8, 0, 6, h); c.fillStyle = '#2f62c9'; c.fillRect(w - 14, 0, 6, h);
    c.font = '700 44px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#d6372d'; c.fillText('+', 60, 34); c.fillStyle = '#2f62c9'; c.fillText('−', 180, 34);
    c.fillStyle = '#20262b'; c.font = '600 20px "JetBrains Mono", monospace'; c.fillText('電源軌', 120, h - 26);
  }), 16, DESK_Y + 4.61, 0, g);
  for (let k = 0; k < RAIL_HOLES; k++){
    const z = -((RAIL_HOLES - 1) / 2) * 10 + k * 10;
    for (const [s, x] of [['+', 13], ['-', 19]]){
      box(1.6, .3, 1.6, M(0x30353a), x, DESK_Y + 4.75, z, g);
      addPin(`R.${s}${k + 1}`, x, RAIL_TOP, z);
    }
  }
}

/* ---------- 杜邦線 ---------- */
export function rebuildWires(){ wires.forEach(w => { disposeWireMesh(w); buildWireMesh(w); }); }
export function buildWireMesh(w){
  if (!G.wires || !G.pins[w.a] || !G.pins[w.b]) return;
  const A = G.pins[w.a].top.clone(), B = G.pins[w.b].top.clone(); A.y += 3.2; B.y += 3.2;
  const dist = A.distanceTo(B), h = 7 + dist * .28;
  const dir = new THREE.Vector3().subVectors(B, A); dir.y = 0;
  const perp = new THREE.Vector3(-dir.z, 0, dir.x); if (perp.lengthSq() > 0) perp.normalize().multiplyScalar(w.bend);
  const curve = new THREE.CubicBezierCurve3(A, A.clone().add(new THREE.Vector3(0, h, 0)).add(perp), B.clone().add(new THREE.Vector3(0, h, 0)).add(perp), B);
  const mat = M(WIRE_COLORS[w.color], { roughness:.45, emissive:0x000000 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, .62, 8, false), mat); tube.castShadow = true;
  const fat = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 2, 6, false), hitMat); fat.userData = { type:'wire', w };
  const grp = new THREE.Group(); grp.add(tube, fat);
  const hm = M(0x141516, { roughness:.6 });
  for (const id of [w.a, w.b]){ const t = G.pins[id].top; box(2.5, 5, 2.5, hm, t.x, t.y + .7, t.z, grp); }
  G.wires.add(grp); G.wireHit.push(fat);
  w.mesh = { grp, mat, mid:curve.getPoint(.5) };
}
export function disposeWireMesh(w){
  if (!w.mesh) return;
  G.wires.remove(w.mesh.grp);
  w.mesh.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== hitMat) o.material.dispose(); });
  const i = G.wireHit.findIndex(f => f.userData.w === w); if (i >= 0) G.wireHit.splice(i, 1);
  w.mesh = null;
}

/* ---------- 視角與狀態 ---------- */
export function fitView(){
  const W = FORMS[bench.board.form].w, a = R.camera.aspect || 1.4;
  const minX = -W - 6, maxX = bench.modules.some(m => m.slot >= 8 || m.slot2 >= 8) ? 112 : 84, width = maxX - minX, depth = Math.max(140, bench.board.header.length / 2 * 5 + 40);
  const vf = THREE.MathUtils.degToRad(R.camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * a);
  const dist = Math.max(width / 2 / Math.tan(hf / 2), depth / 2 / Math.tan(vf / 2)) * 1.08;
  R.controls.target.set((minX + maxX) / 2, -2, 6);
  R.camera.position.copy(R.controls.target).addScaledVector(new THREE.Vector3(0, .74, .67).normalize(), dist);
  R.controls.update();
}
function resize(){
  const el = stageEl, w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  const first = !R._sized; R._sized = true;
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
  if (first) fitView();
}
export function setLed(k, on){
  const L = G.leds[k]; if (!L || L.on === on) return; L.on = on;
  L.mt.emissive.setHex(on ? L.color : 0x000000); L.mt.emissiveIntensity = on ? 1.4 : 0;
  L.mt.color.setHex(on ? L.color : L.base); L.glow.visible = on;
}
export function pressCap(k, down){ const c = G.caps[k]; if (c) c.mesh.position.y = c.y - (down ? .7 : 0); }
export function setUsbVisible(on){ if (G.usb) G.usb.visible = on; }
