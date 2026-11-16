import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DOCK_X, HALL, OFFICE, LANES, PARKING, parkingSpot, WALK_Z, TRUCK_DOCK_Z } from './layout.js';

export const COLORS = {
  blue: '#2f5bd6', blueDark: '#1e44b4', wall: '#eef2fa', concrete: '#f1f4fb', ground: '#dfe7f7', road: '#c6d0e8', teal: '#0ea5a4', cardboard: ['#d9a566', '#cf9a58', '#e0b377', '#c98f4e'],
  wood: '#b98b55', amber: '#f4a62a', yellow: '#f2c230', glass: '#9cc3ff', green: '#16a34a', red: '#ef4444', warn: '#f59e0b',
};
const matCache = new Map();
export function mat(color, { rough = 0.78, metal = 0.04, emissive, emissiveIntensity = 0, transparent = false, opacity = 1 } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${emissiveIntensity}|${transparent}|${opacity}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive || '#000000', emissiveIntensity, transparent, opacity }));
  return matCache.get(key);
}
const geoCache = new Map();
function rbox(w, h, d, r = 0.08) {
  const key = `${w}|${h}|${d}|${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)));
  return geoCache.get(key);
}
const flatBox = (w, h, d) => { const key = `f${w}|${h}|${d}`; if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d)); return geoCache.get(key); };
export function box(w, h, d, color, { x = 0, y = 0, z = 0, r = 0.08, shadow = true, receive = true, flat = false, m } = {}) {
  const mesh = new THREE.Mesh(flat ? flatBox(w, h, d) : rbox(w, h, d, r), m || mat(color));
  mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = receive;
  return mesh;
}
export function cyl(rt, rb, h, color, { x = 0, y = 0, z = 0, seg = 16, shadow = true, m } = {}) {
  const k = `c${rt}|${rb}|${h}|${seg}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  const mesh = new THREE.Mesh(geoCache.get(k), m || mat(color)); mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true; return mesh;
}

/** Marks every mesh below `obj` as pickable for `entity` and returns the meshes. */
export function tagEntity(obj, entity) {
  const out = [];
  obj.traverse((o) => { if (o.isMesh || o.isSprite) { o.userData.entity = entity; out.push(o); } });
  return out;
}

// ------------------------------------------------------------------ sprites with canvas text
export function labelCanvas(text, { fg = '#ffffff', bg = '#2f5bd6', font = '700 40px Inter, system-ui, sans-serif', padX = 26, height = 68, radius = 30, border } = {}) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  ctx.font = font; const w = Math.ceil(ctx.measureText(text).width + padX * 2); c.width = w; c.height = height;
  ctx.font = font; ctx.fillStyle = bg; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, w, height, radius); else ctx.rect(0, 0, w, height);
  ctx.fill(); if (border) { ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, w / 2, height / 2 + 2);
  return c;
}
export function textSprite(text, opts = {}) {
  const { scale = 0.03, depthTest = true } = opts;
  const canvas = labelCanvas(text, opts); const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest }));
  sp.scale.set(canvas.width * scale, canvas.height * scale, 1); sp.userData.baseScale = scale; sp.userData.text = text; sp.renderOrder = 10;
  return sp;
}
export function setSpriteText(sp, text, opts = {}) {
  if (sp.userData.text === text && !opts.force) return;
  const canvas = labelCanvas(text, opts); const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  sp.material.map?.dispose(); sp.material.map = tex; sp.material.needsUpdate = true;
  const s = sp.userData.baseScale || 0.03; sp.scale.set(canvas.width * s, canvas.height * s, 1); sp.userData.text = text;
}
function decal(w, h, draw, { px = 256 } = {}) {
  const c = document.createElement('canvas'); c.width = px * (w / h > 1 ? 2 : 1); c.height = px; const ctx = c.getContext('2d'); draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  return m;
}
const brandDecal = (w, h, text, bg, fg = '#fff') => decal(w, h, (ctx, W, H) => {
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, W, H, 24) : ctx.rect(0, 0, W, H); ctx.fill();
  ctx.fillStyle = fg; ctx.beginPath(); const s = H * 0.55; const cx = H * 0.5 + 14; const cy = H / 2;
  ctx.moveTo(cx, cy - s / 2); ctx.lineTo(cx + s / 2, cy - s / 5); ctx.lineTo(cx + s / 2, cy + s / 4); ctx.lineTo(cx, cy + s / 2); ctx.lineTo(cx - s / 2, cy + s / 4); ctx.lineTo(cx - s / 2, cy - s / 5); ctx.closePath(); ctx.fill();
  ctx.font = `800 ${H * 0.34}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText(text, cx + s / 2 + 18, cy + 2);
});

// ------------------------------------------------------------------ vehicles (nose points to +Z)
export function buildTruck({ cab = '#2563eb', van = false, boxColor = '#f8fafc', accent = '#0ea5a4', brand = 'WareTrack', code = '' } = {}) {
  const g = new THREE.Group(); const wheels = [];
  const dark = '#1b2438';
  if (!van) {
    g.add(box(2.5, 0.4, 8.4, dark, { y: 0.75, z: -0.2, r: 0.05 }));
    g.add(box(3.1, 3.1, 5.8, boxColor, { y: 2.5, z: -1.55, r: 0.16 }));
    g.add(box(3.14, 0.35, 5.84, accent, { y: 1.15, z: -1.55, r: 0.05 }));
    g.add(box(2.9, 2.3, 2.4, cab, { y: 1.95, z: 3.1, r: 0.3 }));
    g.add(box(2.5, 0.95, 0.12, '#233a6a', { y: 2.55, z: 4.3, r: 0.05, m: mat('#274a8a', { rough: 0.2, metal: 0.4 }) }));
    g.add(box(0.12, 0.8, 1.5, '#274a8a', { x: 1.46, y: 2.55, z: 3.45, r: 0.04, m: mat('#274a8a', { rough: 0.2, metal: 0.4 }) }));
    g.add(box(0.12, 0.8, 1.5, '#274a8a', { x: -1.46, y: 2.55, z: 3.45, r: 0.04, m: mat('#274a8a', { rough: 0.2, metal: 0.4 }) }));
    for (const x of [-0.9, 0.9]) g.add(box(0.5, 0.28, 0.12, '#fff', { x, y: 1.05, z: 4.33, r: 0.05, m: mat('#fff7d6', { emissive: '#ffe9a3', emissiveIntensity: 0.6 }) }));
    g.add(box(2.7, 0.35, 0.3, dark, { y: 0.55, z: 4.3, r: 0.1 }));
    for (const z of [3.2, -1.6, -3.4]) for (const x of [-1.3, 1.3]) { const w = cyl(0.55, 0.55, 0.45, dark, { x, y: 0.55, z, seg: 16 }); w.rotation.z = Math.PI / 2; g.add(w); wheels.push(w); }
    for (const s of [1, -1]) { const d = brandDecal(5.1, 1.7, brand, '#2f5bd6'); d.position.set(s * 1.57, 2.55, -1.55); d.rotation.y = s * Math.PI / 2; g.add(d); }
  } else {
    g.add(box(2.3, 0.35, 5.4, dark, { y: 0.7, z: 0, r: 0.05 }));
    g.add(box(2.6, 2.4, 3.6, boxColor, { y: 2.0, z: -0.8, r: 0.2 }));
    g.add(box(2.64, 0.3, 3.64, accent, { y: 1.1, z: -0.8, r: 0.05 }));
    g.add(box(2.5, 1.7, 1.9, cab, { y: 1.65, z: 2.0, r: 0.3 }));
    g.add(box(2.1, 0.8, 0.1, '#274a8a', { y: 2.0, z: 2.97, r: 0.05, m: mat('#274a8a', { rough: 0.2, metal: 0.4 }) }));
    for (const z of [2.0, -1.7]) for (const x of [-1.15, 1.15]) { const w = cyl(0.48, 0.48, 0.4, dark, { x, y: 0.48, z, seg: 14 }); w.rotation.z = Math.PI / 2; g.add(w); wheels.push(w); }
    for (const s of [1, -1]) { const d = brandDecal(3.2, 1.2, brand, '#2f5bd6'); d.position.set(s * 1.32, 2.1, -0.8); d.rotation.y = s * Math.PI / 2; g.add(d); }
  }
  g.userData.wheels = wheels;
  return g;
}

export function buildForklift() {
  const g = new THREE.Group(); const dark = '#1f2937'; const wheels = [];
  g.add(box(1.4, 0.8, 2.0, COLORS.yellow, { y: 0.8, z: -0.2, r: 0.18 }));
  g.add(box(1.4, 0.9, 0.7, dark, { y: 0.95, z: -1.3, r: 0.15 }));
  g.add(box(1.0, 0.18, 0.9, dark, { y: 1.3, z: -0.2, r: 0.05 }));
  for (const x of [-0.6, 0.6]) { g.add(box(0.07, 1.5, 0.07, dark, { x, y: 2.0, z: 0.45, r: 0.02, flat: true })); g.add(box(0.07, 1.5, 0.07, dark, { x, y: 2.0, z: -0.85, r: 0.02, flat: true })); }
  g.add(box(1.4, 0.07, 1.4, dark, { y: 2.75, z: -0.2, r: 0.02, flat: true }));
  g.add(box(0.15, 2.6, 0.15, dark, { x: -0.45, y: 1.35, z: 0.95, r: 0.03 })); g.add(box(0.15, 2.6, 0.15, dark, { x: 0.45, y: 1.35, z: 0.95, r: 0.03 }));
  const forks = new THREE.Group(); forks.position.set(0, 0.25, 1.35);
  for (const x of [-0.4, 0.4]) forks.add(box(0.14, 0.08, 1.3, '#9ca3af', { x, z: 0.1, r: 0.02, flat: true }));
  forks.add(box(1.2, 0.8, 0.08, dark, { y: 0.45, z: -0.5, r: 0.02, flat: true })); g.add(forks); g.userData.forks = forks;
  const drv = new THREE.Group(); drv.add(cyl(0.2, 0.22, 0.6, '#f97316', { y: 1.65, z: -0.15 })); drv.add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), mat('#f1c9a5'))); drv.children[1].position.set(0, 2.1, -0.15);
  drv.add(cyl(0.2, 0.22, 0.12, '#f2c230', { y: 2.26, z: -0.15 })); g.add(drv);
  for (const [x, z] of [[-0.65, 0.5], [0.65, 0.5], [-0.65, -0.9], [0.65, -0.9]]) { const w = cyl(0.36, 0.36, 0.3, dark, { x, y: 0.36, z, seg: 12 }); w.rotation.z = Math.PI / 2; g.add(w); wheels.push(w); }
  const carry = buildPalletStack(6, COLORS.wood); carry.position.set(0, 0.45, 1.5); carry.visible = false; g.add(carry); g.userData.carry = carry; g.userData.wheels = wheels;
  g.scale.setScalar(1.15);
  return g;
}
export function buildPalletStack(boxes = 6, wood = COLORS.wood) {
  const g = new THREE.Group(); g.add(box(1.8, 0.15, 1.1, wood, { y: 0.075, r: 0.02, flat: true }));
  for (let k = 0; k < boxes; k++) { const layer = Math.floor(k / 4); const ix = k % 2; const iz = Math.floor((k % 4) / 2); g.add(box(0.82, 0.48, 0.52, COLORS.cardboard[(k * 7) % 4], { x: (ix - 0.5) * 0.88, y: 0.15 + 0.24 + layer * 0.5, z: (iz - 0.5) * 0.55, r: 0.05 })); }
  return g;
}

const DEPT_HAT = { Receiving: '#f97316', Picking: '#facc15', Shipping: '#3b82f6', Inventory: '#22c55e', Maintenance: '#ef4444', Management: '#f8fafc' };
export function buildWorker(dept, seed = 0) {
  const g = new THREE.Group(); const skin = ['#f1c9a5', '#e0ac85', '#c68863', '#8d5a3b'][seed % 4]; const pants = '#334155';
  const legs = [];
  for (const x of [-0.13, 0.13]) { const pivot = new THREE.Group(); pivot.position.set(x, 0.62, 0); pivot.add(box(0.2, 0.62, 0.22, pants, { y: -0.31, r: 0.05 })); g.add(pivot); legs.push(pivot); }
  g.add(box(0.56, 0.7, 0.34, dept === 'Management' ? '#1e3a8a' : '#f97316', { y: 0.98, r: 0.1 }));
  if (dept !== 'Management') g.add(box(0.58, 0.09, 0.36, '#e5e7eb', { y: 0.95, r: 0.02, flat: true }));
  for (const x of [-0.36, 0.36]) g.add(box(0.15, 0.5, 0.17, dept === 'Management' ? '#1e3a8a' : '#f97316', { x, y: 1.0, r: 0.05 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), mat(skin)); head.position.y = 1.5; head.castShadow = true; g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(DEPT_HAT[dept] || '#facc15')); hat.position.y = 1.54; hat.castShadow = true; g.add(hat);
  g.userData.legs = legs; g.scale.setScalar(1.35);
  return g;
}
export function buildTree(i = 0) {
  const g = new THREE.Group(); g.add(cyl(0.18, 0.26, 1.6, '#8a6a4a', { y: 0.8, seg: 8 }));
  const f = new THREE.Mesh(new THREE.SphereGeometry(1.35 + (i % 3) * 0.2, 14, 12), mat(i % 2 ? '#6dbf8b' : '#57ad78')); f.position.y = 2.9; f.castShadow = true; f.receiveShadow = true; g.add(f);
  const f2 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), mat('#7ccd9a')); f2.position.set(0.6, 3.7, 0.2); f2.castShadow = true; g.add(f2);
  return g;
}

// ------------------------------------------------------------------ buildings
/** Warehouse hall. `near` = walls facing the camera (cut away in interior view), `roof` and `doorGear` toggle too. */
export function buildHall() {
  const root = new THREE.Group(); const roof = new THREE.Group(); const near = new THREE.Group(); const doorGear = new THREE.Group(); const solid = new THREE.Group();
  const w = HALL.x1 - HALL.x0; const d = HALL.z1 - HALL.z0; const cx = (HALL.x0 + HALL.x1) / 2; const cz = (HALL.z0 + HALL.z1) / 2; const H = HALL.wall; const t = HALL.thick;
  root.add(solid, near, roof, doorGear);
  solid.add(box(w, 0.2, d, '#e1e8f6', { x: cx, y: 0.1, z: cz, flat: true }));
  solid.add(box(w + 0.5, H, t, COLORS.wall, { x: cx, y: H / 2, z: HALL.z0 - t / 2 + 0.25, r: 0.04 }));
  solid.add(box(t, H, d + 0.5, COLORS.wall, { x: HALL.x0 - t / 2 + 0.25, y: H / 2, z: cz, r: 0.04 }));
  solid.add(box(w + 0.7, 0.55, t + 0.2, COLORS.blue, { x: cx, y: H - 0.3, z: HALL.z0 - t / 2 + 0.25, r: 0.04 }));
  solid.add(box(t + 0.2, 0.55, d + 0.7, COLORS.blue, { x: HALL.x0 - t / 2 + 0.25, y: H - 0.3, z: cz, r: 0.04 }));
  // near walls
  near.add(box(t, H, d, COLORS.wall, { x: HALL.x1 - t / 2, y: H / 2, z: cz, r: 0.04 }));
  near.add(box(t + 0.2, 0.55, d + 0.5, COLORS.blue, { x: HALL.x1 - t / 2, y: H - 0.3, z: cz, r: 0.04 }));
  const fz = HALL.z1 - t / 2; let prev = HALL.x0;
  const seg = (x0, x1) => { if (x1 - x0 > 0.01) { near.add(box(x1 - x0, H, t, COLORS.wall, { x: (x0 + x1) / 2, y: H / 2, z: fz, r: 0.04 })); } };
  const DW = 6; const DH = 4.4;
  DOCK_X.forEach((x) => { seg(prev, x - DW / 2); near.add(box(DW, H - DH, t, COLORS.wall, { x, y: DH + (H - DH) / 2, z: fz, r: 0.04 })); prev = x + DW / 2; });
  seg(prev, HALL.x1);
  near.add(box(w + 0.5, 0.55, t + 0.2, COLORS.blue, { x: cx, y: H - 0.3, z: fz, r: 0.04 }));
  // door gear: frames, rolled shutters, bumpers, plates
  const plates = [];
  DOCK_X.forEach((x, i) => {
    const z = HALL.z1 - t / 2;
    doorGear.add(box(0.4, DH, 0.8, COLORS.blue, { x: x - DW / 2, y: DH / 2, z, r: 0.06 })); doorGear.add(box(0.4, DH, 0.8, COLORS.blue, { x: x + DW / 2, y: DH / 2, z, r: 0.06 }));
    doorGear.add(box(DW + 0.8, 0.4, 0.8, COLORS.blue, { x, y: DH + 0.2, z, r: 0.06 })); doorGear.add(box(DW - 0.4, 0.45, 0.5, '#cfd8ea', { x, y: DH - 0.35, z: z - 0.1, r: 0.1 }));
    solid.add(box(5, 0.18, 1.5, '#475569', { x, y: 0.2, z: HALL.z1 + 0.65, r: 0.04 }));
    for (const s of [-2, 2]) doorGear.add(box(0.5, 0.5, 0.35, '#111827', { x: x + s, y: 1.0, z: HALL.z1 + 1.55, r: 0.1 }));
    const p = textSprite(String(i + 1), { bg: COLORS.blue, fg: '#fff', font: '800 44px Inter, system-ui, sans-serif', padX: 18, height: 64, scale: 0.03 }); p.position.set(x, H + 0.9, HALL.z1 + 0.3); doorGear.add(p); plates.push(p);
  });
  // roof (blue, ribs + logo)
  roof.add(box(w + 1.2, 0.5, d + 1.2, COLORS.blue, { x: cx, y: H + 0.25, z: cz, r: 0.1 }));
  for (let i = 0; i < 6; i++) roof.add(box(w + 1.0, 0.3, 0.7, COLORS.blueDark, { x: cx, y: H + 0.6, z: HALL.z0 + 2 + i * 5.2, r: 0.08 }));
  const logo = brandDecal(14, 5, 'WareTrack', '#ffffff', COLORS.blue); logo.rotation.x = -Math.PI / 2; logo.position.set(-12, H + 0.78, 5); roof.add(logo);
  root.userData = { roof, near, doorGear, solid, plates };
  return root;
}
export function buildOffice() {
  const g = new THREE.Group(); const w = OFFICE.x1 - OFFICE.x0; const d = OFFICE.z1 - OFFICE.z0; const cx = (OFFICE.x0 + OFFICE.x1) / 2; const cz = (OFFICE.z0 + OFFICE.z1) / 2; const H = OFFICE.h;
  g.add(box(w, H, d, '#f6f8fd', { x: cx, y: H / 2, z: cz, r: 0.12 }));
  g.add(box(w + 0.3, 0.5, d + 0.3, COLORS.blue, { x: cx, y: 3.85, z: cz, r: 0.08 }));
  g.add(box(w + 0.8, 0.5, d + 0.8, COLORS.blue, { x: cx, y: H + 0.2, z: cz, r: 0.1 }));
  const glass = mat(COLORS.glass, { rough: 0.15, metal: 0.3, emissive: '#6aa0ff', emissiveIntensity: 0.15 });
  for (let f = 0; f < 2; f++) for (let i = 0; i < 5; i++) {
    const x = OFFICE.x0 + 1.8 + i * 3.1; const y = 1.9 + f * 3.7;
    if (!(f === 0 && i === 2)) g.add(box(2.0, 1.6, 0.14, '#9cc3ff', { x, y, z: OFFICE.z1 + 0.05, r: 0.04, m: glass }));
  }
  for (let f = 0; f < 2; f++) for (let i = 0; i < 3; i++) g.add(box(0.14, 1.6, 2.0, '#9cc3ff', { x: OFFICE.x1 + 0.05, y: 1.9 + f * 3.7, z: OFFICE.z0 + 2.2 + i * 3.5, r: 0.04, m: glass }));
  g.add(box(2.6, 2.9, 0.16, '#274a8a', { x: OFFICE.doorX, y: 1.45, z: OFFICE.z1 + 0.07, r: 0.05, m: mat('#274a8a', { rough: 0.2, metal: 0.4 }) }));
  g.add(box(5, 0.25, 1.8, COLORS.blue, { x: OFFICE.doorX, y: 3.3, z: OFFICE.z1 + 0.9, r: 0.08 }));
  const sign = textSprite('OFFICE', { bg: '#ffffff', fg: COLORS.blue, border: COLORS.blue, scale: 0.028 }); sign.position.set(OFFICE.doorX, H + 1.9, OFFICE.z1 - 1); g.add(sign); g.userData.sign = sign;
  return g;
}
export function buildContainer() {
  const g = new THREE.Group(); g.add(box(12, 3.1, 3.1, '#14b8a6', { y: 1.65, r: 0.1 }));
  for (let i = -5; i <= 5; i++) g.add(box(0.14, 2.9, 3.2, '#0f9488', { x: i * 1.0, y: 1.65, r: 0.02, flat: true }));
  const d = brandDecal(6, 1.5, 'WARETRACK', '#0d7a72'); d.position.set(0, 1.7, 1.58); g.add(d);
  return g;
}

// ------------------------------------------------------------------ ground, roads and markings
export function buildGround() {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 420), mat(COLORS.ground, { rough: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);
  g.add(box(128, 0.1, 22, COLORS.concrete, { x: 3, y: 0.05, z: 20.5, flat: true, shadow: false }));
  const apronEast = box(50, 0.1, 40, COLORS.concrete, { x: 45, y: 0.05, z: -2, flat: true, shadow: false }); g.add(apronEast);
  g.add(box(220, 0.14, LANES.roadWidth, COLORS.road, { x: 0, y: 0.07, z: LANES.roadCenter, flat: true, shadow: false }));
  for (const z of [LANES.roadCenter - LANES.roadWidth / 2 - 0.25, LANES.roadCenter + LANES.roadWidth / 2 + 0.25]) g.add(box(220, 0.3, 0.5, '#f8fafc', { x: 0, y: 0.15, z, flat: true }));
  const dashes = new THREE.InstancedMesh(flatBox(2.4, 0.02, 0.22), mat('#ffffff'), 60); const m4 = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) { m4.makeTranslation(-110 + i * 3.8, 0.16, LANES.roadCenter + 0.1); dashes.setMatrixAt(i, m4); }
  dashes.receiveShadow = true; g.add(dashes);
  // yellow bay outlines (docks + parking)
  const lines = []; const outline = (cx, cz, w, d) => { lines.push([cx - w / 2, cz, 0.14, d], [cx + w / 2, cz, 0.14, d], [cx, cz - d / 2, w, 0.14], [cx, cz + d / 2, w, 0.14]); };
  DOCK_X.forEach((x) => outline(x, TRUCK_DOCK_Z + 0.4, 4.4, 10.4));
  for (let s = 0; s < PARKING.slots; s++) { const p = parkingSpot(s); outline(p.x, p.z + 0.5, 4.2, 10); }
  const ys = new THREE.InstancedMesh(flatBox(1, 0.02, 1), mat('#e9b949', { rough: 0.9 }), lines.length);
  lines.forEach(([x, z, w, d], i) => { m4.compose(new THREE.Vector3(x, 0.12, z), new THREE.Quaternion(), new THREE.Vector3(w, 1, d)); ys.setMatrixAt(i, m4); }); ys.receiveShadow = true; g.add(ys);
  return g;
}
