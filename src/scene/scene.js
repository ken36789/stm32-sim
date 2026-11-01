// 3D 場景：工作墊、開發板、J1 排針、外接模組、杜邦線
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { J1, MODS, PINS, boardPinPos, modPinPos, WIRE_COLORS, mulberry32, hex6 } from '../core/board.js';

let stageEl = null;
export const DESK_Y = -7, PIN_TOP_BOARD = 8.5, PIN_TOP_MOD = 5.5;
export const R = {};             // renderer, scene, camera, controls
export const G = { pins:{}, leds:{}, caps:{}, hit:[], wires:null, usb:null, glowTex:null, extLight:null, senChip:null, ready:false };

export function pinTop(id){
  const p = PINS[id];
  if (p.group === 'board'){ const q = boardPinPos(+id.slice(3) - 1); return new THREE.Vector3(q.x, PIN_TOP_BOARD, q.z); }
  const j = MODS[p.group].pins.findIndex(x => x[0] === p.name); const q = modPinPos(p.group, j);
  return new THREE.Vector3(q.x, PIN_TOP_MOD, q.z);
}

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
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || R.scene).add(m); return m;
}
export function cyl(r, h, mat, x, y, z, parent, seg = 24){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || R.scene).add(m); return m;
}
export function topPlane(w, d, tex, x, y, z, parent){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map:tex, roughness:.75, metalness:.05 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; (parent || R.scene).add(m); return m;
}
export function hitTarget(r, x, y, z, data, parent){
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false }));
  m.position.set(x, y, z); m.userData = data; (parent || R.scene).add(m); G.hit.push(m); return m;
}
export function glowSprite(color, size){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:G.glowTex, color, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); s.visible = false; return s;
}

/* ---- 開發板絲印 ---- */
export function drawBoard(g, W, H){
  const S = 20, X = x => (x + 55) * S, Z = z => (z + 25) * S;
  g.fillStyle = '#14191d'; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(11); g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 110; k++){
    g.strokeStyle = k % 3 ? '#1b2227' : '#1f272d'; g.lineWidth = k % 4 ? 3 : 6;
    let x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 3; s++){ const a = Math.floor(rnd() * 8) * Math.PI / 4, len = 60 + rnd() * 240; x += Math.cos(a) * len; y += Math.sin(a) * len; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = '#28323a'; for (let k = 0; k < 140; k++){ g.beginPath(); g.arc(rnd() * W, rnd() * H, 4, 0, 7); g.fill(); }
  // 安裝孔
  for (const [x, z] of [[-52,-22],[-52,22],[4,-22],[4,22]]){
    g.fillStyle = '#b58a3a'; g.beginPath(); g.arc(X(x), Z(z), 34, 0, 7); g.fill();
    g.fillStyle = '#0a0c0e'; g.beginPath(); g.arc(X(x), Z(z), 22, 0, 7); g.fill();
  }
  // MCU 焊墊外框
  g.strokeStyle = '#e6ebee'; g.lineWidth = 3; g.strokeRect(X(-35), Z(-15), 26 * S, 26 * S);
  g.fillStyle = '#e6ebee'; g.beginPath(); g.arc(X(-34), Z(-14), 8, 0, 7); g.fill();
  const txt = (s, x, z, size = 22, align = 'center', font = 'JetBrains Mono') => { g.font = `600 ${size}px "${font}", monospace`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, z); };
  g.fillStyle = '#e6ebee';
  txt('U1', X(-36.6), Z(-16.4), 20, 'left');
  // J1 腳位標示
  J1.forEach(([n], i) => {
    const p = boardPinPos(i);
    if (i % 2 === 0) txt(n, X(12.2), Z(p.z), 26, 'right'); else txt(n, X(21.8), Z(p.z), 26, 'left');
  });
  txt('J1', X(9.6), Z(-24), 20, 'right');
  g.beginPath(); g.moveTo(X(11.6), Z(-24.6)); g.lineTo(X(12.8), Z(-24.6)); g.lineTo(X(12.2), Z(-23.7)); g.closePath(); g.fill();
  // LED、按鈕、其他標示
  [['LD1',-10],['LD2',-6],['LD3',-2]].forEach(([s, x]) => txt(s, X(x), Z(20.6), 20));
  txt('B1 USER', X(-34), Z(20.8), 20); txt('B2 RESET', X(-44.5), Z(20.8), 20);
  txt('CN1 USB', X(-47.6), Z(-7.6), 20, 'left');
  txt('PWR', X(-45), Z(-18.8), 18); txt('COM', X(-40), Z(-18.8), 18);
  txt('ST-LINK V3', X(-41.5), Z(1.6), 18);
  txt('X1 8MHz', X(-3.4), Z(-6.4), 18);
  txt('STM32H743ZI 開發板', X(-47.5), Z(23.3), 30, 'left', 'Chakra Petch');
  txt('REV C', X(-1), Z(23.3), 20, 'right');
}
export function drawChip(g, W, H){
  g.fillStyle = '#1a1d21'; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(3); for (let k = 0; k < 900; k++){ g.fillStyle = `rgba(255,255,255,${rnd() * .025})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
  g.fillStyle = '#121417'; g.beginPath(); g.arc(56, 56, 20, 0, 7); g.fill();
  g.fillStyle = '#c6ccd1'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 58px "JetBrains Mono", monospace'; g.fillText('STM32H743', W / 2, H / 2 - 50);
  g.font = '600 50px "JetBrains Mono", monospace'; g.fillText('ZIT6', W / 2, H / 2 + 12);
  g.font = '400 30px "JetBrains Mono", monospace'; g.fillStyle = '#9aa2a8'; g.fillText('Cortex-M7  480MHz', W / 2, H / 2 + 72); g.fillText('GH24Q  TWN 2638', W / 2, H / 2 + 112);
}
export function drawMat(g, W, H){
  g.fillStyle = '#4c6a77'; g.fillRect(0, 0, W, H);
  const S = W / 300;
  for (let x = 0; x <= 300; x += 10){ g.strokeStyle = x % 50 ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.16)'; g.lineWidth = x % 50 ? 1 : 2; g.beginPath(); g.moveTo(x * S, 0); g.lineTo(x * S, H); g.stroke(); }
  for (let z = 0; z <= 200; z += 10){ g.strokeStyle = z % 50 ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.16)'; g.lineWidth = z % 50 ? 1 : 2; g.beginPath(); g.moveTo(0, z * S); g.lineTo(W, z * S); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '600 15px "JetBrains Mono", monospace'; g.textBaseline = 'top';
  for (let x = 0; x <= 300; x += 50) g.fillText(String(x / 10) + (x === 300 ? ' cm' : ''), x * S + 4, 4);
  g.fillText('ESD SAFE · 防靜電工作墊', 8, H - 22);
}
export function drawModule(key){
  const m = MODS[key], S = 20, W = m.w * S, H = m.d * S;
  return ctex(W, H, g => {
    g.fillStyle = hex6(m.pcb); g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 3; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#eef2f4'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '600 26px "JetBrains Mono", monospace';
    m.pins.forEach(([n], j) => { const p = modPinPos(key, j); g.fillText(n, (p.x - (m.cx - m.w / 2) + 2.6) * S, (p.z - (m.cz - m.d / 2)) * S); });
    g.font = '600 22px "Chakra Petch", sans-serif'; g.textAlign = 'right';
    const title = { LED:'LED · R1 220Ω', BTN:'KEY · 10kΩ PD', SEN:'TEMP · I2C 0x76' }[key];
    g.fillText(title, W - 16, H - 20);
    g.fillStyle = '#b58a3a'; g.beginPath(); g.arc(W - 30, 30, 16, 0, 7); g.fill(); g.fillStyle = '#0a0c0e'; g.beginPath(); g.arc(W - 30, 30, 9, 0, 7); g.fill();
  });
}

/* ---- 建立場景 ---- */
export function sceneBg(){ return getComputedStyle(document.documentElement).getPropertyValue('--scene').trim() || '#c9d3d9'; }
export function buildScene(stage){
  stageEl = stage;
  R.renderer = new THREE.WebGLRenderer({ antialias:true });
  R.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  R.renderer.shadowMap.enabled = true; R.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.insertBefore(R.renderer.domElement, stage.firstChild);
  R.scene = new THREE.Scene(); R.scene.background = new THREE.Color(sceneBg());
  R.camera = new THREE.PerspectiveCamera(36, 1, 1, 2000);
  R.controls = new OrbitControls(R.camera, R.renderer.domElement);
  R.controls.enableDamping = true; R.controls.dampingFactor = .09;
  R.controls.maxPolarAngle = Math.PI * .47; R.controls.minDistance = 45; R.controls.maxDistance = 380;

  R.scene.add(new THREE.HemisphereLight(0xffffff, 0x3d4c55, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(45, 140, 70); sun.castShadow = true;
  const coarse = matchMedia('(pointer:coarse)').matches; sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left:-110, right:110, top:90, bottom:-90, near:10, far:400 }); sun.shadow.bias = -.0008; sun.shadow.camera.updateProjectionMatrix();
  R.scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbfd6ff, .8); fill.position.set(-80, 60, -60); R.scene.add(fill);

  G.glowTex = ctex(128, 128, (g, w) => { const gr = g.createRadialGradient(w/2, w/2, 0, w/2, w/2, w/2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });

  // 工作墊
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(300, 200), new THREE.MeshStandardMaterial({ map:ctex(1500, 1000, drawMat), roughness:.95 }));
  mat.rotation.x = -Math.PI / 2; mat.position.set(5, DESK_Y, 0); mat.receiveShadow = true; R.scene.add(mat);

  // 開發板
  const pcbSide = M(0x111417, { roughness:.8 });
  box(80, 1.6, 50, pcbSide, -15, -.8, 0);
  topPlane(80, 50, ctex(1600, 1000, drawBoard), -15, .01, 0);
  const brass = M(0xc9a24f, { metalness:.5, roughness:.35 });
  for (const [x, z] of [[-52,-22],[-52,22],[4,-22],[4,22]]) cyl(1.6, 5.4, brass, x, DESK_Y + 2.7, z, null, 6);

  // MCU（LQFP144）
  box(20, 1.6, 20, M(0x1a1d21), -22, .8, -2);
  topPlane(20, 20, ctex(512, 512, drawChip), -22, 1.61, -2);
  const legGeo = new THREE.BoxGeometry(.26, .25, 1.5), legMat = M(0xbfc5ca, { metalness:.6, roughness:.3 });
  const legs = new THREE.InstancedMesh(legGeo, legMat, 144); const d = new THREE.Object3D(); let li = 0;
  for (let s = 0; s < 4; s++) for (let k = 0; k < 36; k++){
    const o = -8.75 + k * .5;
    if (s === 0) { d.position.set(-22 + o, .15, -2 - 10.6); d.rotation.set(0, 0, 0); }
    if (s === 1) { d.position.set(-22 + o, .15, -2 + 10.6); d.rotation.set(0, 0, 0); }
    if (s === 2) { d.position.set(-22 - 10.6, .15, -2 + o); d.rotation.set(0, Math.PI / 2, 0); }
    if (s === 3) { d.position.set(-22 + 10.6, .15, -2 + o); d.rotation.set(0, Math.PI / 2, 0); }
    d.updateMatrix(); legs.setMatrixAt(li++, d.matrix);
  }
  R.scene.add(legs);

  // ST-LINK 晶片、晶振、穩壓器、被動元件
  box(7, 1.2, 7, M(0x1d2024), -41.5, .6, -3);
  box(6, 1.3, 2.6, M(0xcfd3d6, { metalness:.55, roughness:.3 }), -3.4, .65, -3);
  box(6.5, 1.8, 3.6, M(0x23262a), -30, .9, -21);
  const rnd = mulberry32(5), capMat = M(0xb48a5a), resMat = M(0x1b1b1b);
  for (let k = 0; k < 46; k++){
    const x = -54 + rnd() * 58, z = -24 + rnd() * 48;
    if (x > -35 && x < -9 && z > -15 && z < 11) continue;
    if (x > -48 && x < -26 && z > 10) continue;
    if (x < -46 && z > -20 && z < -8) continue;
    const r = rnd() > .5; box(r ? 1.6 : 1, .5, r ? .8 : .5, rnd() > .45 ? capMat : resMat, x, .25, z).rotation.y = rnd() > .5 ? Math.PI / 2 : 0;
  }

  // USB 母座（可點擊插拔）
  box(7, 3.2, 9, M(0xb9bec2, { metalness:.7, roughness:.25 }), -52, 1.6, -14);
  hitTarget(5.2, -53, 2, -14, { type:'usb' });
  G.usb = new THREE.Group();
  box(9, 4.2, 7.5, M(0x2b2f33), -60.5, 1.8, -14, G.usb);
  const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(-65, 1.8, -14), new THREE.Vector3(-82, 0, -16), new THREE.Vector3(-100, DESK_Y + 1.2, -30), new THREE.Vector3(-140, DESK_Y + 1.2, -55)]);
  const cm = new THREE.Mesh(new THREE.TubeGeometry(cable, 40, 1.3, 10, false), M(0x2b2f33, { roughness:.5 })); cm.castShadow = true; G.usb.add(cm);
  R.scene.add(G.usb);
  hitTarget(5, -61, 2, -14, { type:'usb' });

  // 板載 LED
  const ledDef = { PWR:[-45,-21,0xff3b30], COM:[-40,-21,0xff3b30], LD1:[-10,18,0x2fe36b], LD2:[-6,18,0xffc21a], LD3:[-2,18,0xff3b30] };
  for (const [k, [x, z, c]] of Object.entries(ledDef)){
    const mt = M(0xe8e2d6, { roughness:.35, emissive:0x000000 });
    box(1.8, .9, 1.1, mt, x, .45, z);
    const glow = glowSprite(c, 9); glow.position.set(x, 1.6, z); R.scene.add(glow);
    G.leds[k] = { mt, glow, color:c, on:false, base:0xe8e2d6 };
  }

  // 按鈕 B1、B2
  for (const [k, x, z, c] of [['B1', -34, 15, 0x2459d6], ['B2', -44.5, 15, 0x1d1f22]]){
    box(5.4, 1.6, 5.4, M(0xbfc4c8, { metalness:.6, roughness:.3 }), x, .8, z);
    const cap = cyl(1.75, 1.5, M(c, { roughness:.45 }), x, 2.35, z);
    G.caps[k] = { mesh:cap, y:2.35 };
    hitTarget(3.6, x, 2.6, z, { type:'press', which:k });
  }

  // J1 排針
  box(10, 2.5, 50, M(0x16181b, { roughness:.7 }), 16.5, 1.25, 0);
  const gold = M(0xd6ac4e, { metalness:.55, roughness:.32 });
  const pinGeo = new THREE.BoxGeometry(.9, 9.2, .9);
  J1.forEach((_, i) => {
    const id = 'J1-' + (i + 1), p = boardPinPos(i);
    const m = new THREE.Mesh(pinGeo, gold); m.position.set(p.x, PIN_TOP_BOARD - 4.6, p.z); m.castShadow = true; R.scene.add(m);
    addPinMarker(id, p.x, PIN_TOP_BOARD, p.z);
  });

  // 外接模組
  for (const key of Object.keys(MODS)) buildModule(key, gold);

  G.wires = new THREE.Group(); R.scene.add(G.wires);
  fitView(); resize();
  new ResizeObserver(resize).observe(stage);
  G.ready = true;
}
export function addPinMarker(id, x, y, z){
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, .3, 8, 28), new THREE.MeshBasicMaterial({ color:0xffffff, depthTest:false, transparent:true }));
  ring.rotation.x = Math.PI / 2; ring.position.set(x, y + .4, z); ring.visible = false; ring.renderOrder = 5; R.scene.add(ring);
  const hit = hitTarget(2.4, x, y - .6, z, { type:'pin', id });
  G.pins[id] = { ring, hit, top:new THREE.Vector3(x, y, z) };
}
export function buildModule(key, gold){
  const m = MODS[key], grp = new THREE.Group(); grp.position.set(m.cx, -3, m.cz); R.scene.add(grp);
  box(m.w, 1.6, m.d, M(m.pcb, { roughness:.7 }), 0, -.8, 0, grp);
  topPlane(m.w, m.d, drawModule(key), 0, .01, 0, grp);
  for (const [x, z] of [[-m.w/2+2, -m.d/2+2], [m.w/2-2, -m.d/2+2], [-m.w/2+2, m.d/2-2], [m.w/2-2, m.d/2-2]]) cyl(.9, 2.4, M(0x2a2d31), x, -2.8, z, grp, 6);
  box(3, 2.5, m.pins.length * 5, M(0x16181b), -m.w / 2 + 3, 1.25, 0, grp);
  const pinGeo = new THREE.BoxGeometry(.9, 9.2, .9);
  m.pins.forEach(([n], j) => {
    const p = modPinPos(key, j);
    const pm = new THREE.Mesh(pinGeo, gold); pm.position.set(p.x - m.cx, PIN_TOP_MOD + 3 - 4.6, p.z - m.cz); grp.add(pm);
    addPinMarker(key + '.' + n, p.x, PIN_TOP_MOD, p.z);
  });
  if (key === 'LED'){
    const lm = M(0xd8261c, { transparent:true, opacity:.88, roughness:.2, emissive:0x000000 });
    cyl(2.6, .6, lm, 5, .3, -1, grp, 28);
    cyl(2.4, 4.2, lm, 5, 2.7, -1, grp, 28);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), lm); dome.position.set(5, 4.8, -1); grp.add(dome);
    const glow = glowSprite(0xff3b2a, 22); glow.position.set(m.cx + 5, 3.2, m.cz - 1); R.scene.add(glow);
    const light = new THREE.PointLight(0xff3b2a, 0, 40, 2); light.position.set(m.cx + 5, 6, m.cz - 1); R.scene.add(light);
    G.leds.EXT = { mt:lm, glow, color:0xff2a1a, on:false, light, base:0xd8261c };
    const r = box(4.2, 1.1, 1.1, M(0xd9c6a0), 4, .6, 4.2, grp);
    [-1.2, -.4, .4].forEach((o, i) => box(.3, 1.15, 1.15, M([0xd23a2a, 0xd23a2a, 0x6b3a1a][i]), 4 + o, .6, 4.2, grp));
    r.castShadow = true;
  }
  if (key === 'BTN'){
    box(6, 1.8, 6, M(0x2b2e33, { metalness:.4, roughness:.4 }), 4.5, .9, -1.5, grp);
    const cap = cyl(1.9, 1.8, M(0x1e2024, { roughness:.5 }), 4.5, 2.7, -1.5, grp);
    G.caps.BTN = { mesh:cap, y:2.7 };
    hitTarget(4, m.cx + 4.5, -3 + 3, m.cz - 1.5, { type:'press', which:'BTN' });
  }
  if (key === 'SEN'){
    const chip = box(3.4, 1.1, 3.4, M(0xcdd2d6, { metalness:.65, roughness:.28 }), 4.5, .55, -3, grp);
    G.senChip = chip;
    box(1.6, .7, .9, M(0xb48a5a), 1.2, .35, 4, grp); box(1.6, .7, .9, M(0xb48a5a), 4.2, .35, 4, grp);
    box(2.4, .9, 1.6, M(0x1b1b1b), 7.2, .45, 4, grp);
    hitTarget(4.2, m.cx + 4.5, -1.6, m.cz - 3, { type:'sensor' });
  }
}
export function fitView(){
  const a = R.camera.aspect || 1.4;
  const dist = a > 1.5 ? 175 : a > 1.1 ? 205 : a > .8 ? 250 : 300;
  const dir = new THREE.Vector3(.02, .72, .69).normalize();
  R.controls.target.set(a > 1.1 ? 3 : 0, -2, 4);
  R.camera.position.copy(R.controls.target).addScaledVector(dir, dist);
  R.controls.update();
}
export function resize(){
  const el = stageEl, w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  const first = !R._sized; R._sized = true;
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
  if (first) fitView();
}
export function setLed(k, on){
  const L = G.leds[k]; if (!L || L.on === on) return; L.on = on;
  L.mt.emissive.setHex(on ? L.color : 0x000000); L.mt.emissiveIntensity = on ? 1.4 : 0;
  if (k !== 'EXT') L.mt.color.setHex(on ? L.color : L.base);
  L.glow.visible = on; if (L.light) L.light.intensity = on ? 120 : 0;
}
export function pressCap(k, down){ const c = G.caps[k]; if (c) c.mesh.position.y = c.y - (down ? .7 : 0); }
export function setSensorDamaged(d){ if (G.senChip) G.senChip.material.color.setHex(d ? 0x3a2b22 : 0xcdd2d6); }

/* ---- 杜邦線 ---- */
export function attachPoint(id){ const t = pinTop(id); t.y += 3.2; return t; }
export function buildWireMesh(w){
  if (!G.ready) return;
  const A = attachPoint(w.a), B = attachPoint(w.b), dist = A.distanceTo(B), h = 7 + dist * .3;
  const dir = new THREE.Vector3().subVectors(B, A); dir.y = 0;
  const perp = new THREE.Vector3(-dir.z, 0, dir.x); if (perp.lengthSq() > 0) perp.normalize().multiplyScalar(w.bend);
  const c1 = A.clone().add(new THREE.Vector3(0, h, 0)).add(perp), c2 = B.clone().add(new THREE.Vector3(0, h, 0)).add(perp);
  const curve = new THREE.CubicBezierCurve3(A, c1, c2, B);
  const mat = M(WIRE_COLORS[w.color], { roughness:.45, emissive:0x000000 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, .62, 8, false), mat); tube.castShadow = true;
  const fat = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 2, 6, false), new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false }));
  fat.userData = { type:'wire', w };
  const grp = new THREE.Group(); grp.add(tube, fat);
  const hm = M(0x141516, { roughness:.6 });
  for (const id of [w.a, w.b]){ const t = pinTop(id); const hb = box(2.5, 5, 2.5, hm, t.x, t.y + .7, t.z, grp); hb.castShadow = true; }
  G.wires.add(grp); G.hit.push(fat);
  w.mesh = { grp, tube, fat, mat, mid: curve.getPoint(.5) };
}
export function disposeWireMesh(w){
  if (!w.mesh) return;
  G.wires.remove(w.mesh.grp);
  w.mesh.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  const i = G.hit.indexOf(w.mesh.fat); if (i >= 0) G.hit.splice(i, 1);
  w.mesh = null;
}
